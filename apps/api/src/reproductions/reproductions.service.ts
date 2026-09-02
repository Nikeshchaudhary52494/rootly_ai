import { prisma } from '../prisma';
import { notFound } from '../errors';
import { ReproductionStatus, ReproductionResult, Prisma } from '../generated/prisma/client';
import { decryptToken } from '../github/utils/github-token-crypto';
import * as github from '../github/github.service';
import {
  runReproduction,
  determineTargetCommit,
  type ReproductionEngineResult,
  type ReproductionEngineStage,
  type TestGenerationInput,
} from '@rootly.ai/reproduction';
import { createOpenAILLM, type InvestigationLLM } from '@rootly.ai/agent';

const DEFAULT_MODEL = 'gpt-4o-mini';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export class ReproductionPreconditionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/** Structured, secret-free observability — never includes the GitHub token or OpenAI key. */
function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...fields }));
}

async function loadPreconditionData(incidentId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  const codeContext = await prisma.incidentCodeContext.findUnique({
    where: { incidentId },
    include: { files: true, commits: { orderBy: { committedAt: 'desc' } } },
  });

  const investigation = await prisma.investigation.findFirst({
    where: { incidentId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    include: { hypotheses: { orderBy: { rank: 'asc' } }, evidence: true },
  });

  const repository = codeContext?.repositoryId
    ? await prisma.repository.findUnique({ where: { id: codeContext.repositoryId } })
    : null;

  const precondition =
    'A completed AI investigation and ready code context are required before reproduction.';

  if (!codeContext || codeContext.status !== 'READY') {
    throw new ReproductionPreconditionError('REPRODUCTION_PRECONDITION_FAILED', precondition);
  }
  if (!repository) {
    throw new ReproductionPreconditionError('REPRODUCTION_PRECONDITION_FAILED', precondition);
  }
  if (!investigation) {
    throw new ReproductionPreconditionError('REPRODUCTION_PRECONDITION_FAILED', precondition);
  }
  if (!investigation.summary || investigation.finalConfidence == null) {
    throw new ReproductionPreconditionError('REPRODUCTION_PRECONDITION_FAILED', precondition);
  }
  if (investigation.hypotheses.length === 0 || investigation.evidence.length === 0) {
    throw new ReproductionPreconditionError('REPRODUCTION_PRECONDITION_FAILED', precondition);
  }
  if (!codeContext.primaryFilePath || codeContext.primaryLineNumber == null) {
    throw new ReproductionPreconditionError('REPRODUCTION_PRECONDITION_FAILED', precondition);
  }

  const targetCommitSha = determineTargetCommit({
    codeContextCommitSha: null,
    recentCommits: codeContext.commits.map((c) => ({ sha: c.sha })),
    defaultBranch: repository.defaultBranch,
  });
  if (!targetCommitSha) {
    throw new ReproductionPreconditionError(
      'REPRODUCTION_PRECONDITION_FAILED',
      'No target commit could be determined for this repository.',
    );
  }

  return { incident, codeContext, investigation, repository, targetCommitSha };
}

async function buildTestGenerationInput(
  incident: NonNullable<Awaited<ReturnType<typeof loadPreconditionData>>['incident']>,
  investigation: Awaited<ReturnType<typeof loadPreconditionData>>['investigation'],
  codeContext: Awaited<ReturnType<typeof loadPreconditionData>>['codeContext'],
  repository: NonNullable<Awaited<ReturnType<typeof loadPreconditionData>>['repository']>,
  accessToken: string,
): Promise<TestGenerationInput> {
  const latestEvent = await prisma.errorEvent.findUnique({ where: { id: incident.latestEventId } });

  let packageJsonContent: string | null = null;
  try {
    packageJsonContent = await github.getFileContent(
      accessToken,
      repository.owner,
      repository.name,
      'package.json',
      repository.defaultBranch,
    );
  } catch {
    // best-effort only — the prompt works fine without it
  }

  return {
    incident: {
      errorName: incident.errorName,
      errorMessage: incident.errorMessage,
      occurrenceCount: incident.occurrenceCount,
    },
    latestEvent: latestEvent ? { stackTrace: latestEvent.stackTrace, errorMessage: latestEvent.errorMessage } : null,
    investigation: {
      summary: investigation!.summary,
      rootCause: investigation!.summary!,
      recommendation: investigation!.recommendation,
      confidence: investigation!.finalConfidence,
      hypotheses: investigation!.hypotheses.map((h) => ({
        title: h.title,
        description: h.description,
        confidence: h.confidence,
        status: h.status,
      })),
    },
    codeContext: {
      primaryFilePath: codeContext!.primaryFilePath!,
      primaryLineNumber: codeContext!.primaryLineNumber,
      files: codeContext!.files
        .filter((f) => f.isPrimary)
        .map((f) => ({
          filePath: f.filePath,
          functionName: f.functionName,
          content: f.content,
          contentStartLine: f.contentStartLine,
          contentEndLine: f.contentEndLine,
        })),
      relatedTests: codeContext!.files.filter((f) => !f.isPrimary).map((f) => ({ filePath: f.filePath, content: f.content })),
    },
    packageJsonContent,
  };
}

/**
 * Validates preconditions, creates the ReproductionRun record, and kicks off
 * the (potentially 30-60s) pipeline without blocking the request — see
 * executeReproduction, which persists status after every stage and always
 * resolves the run out of a non-terminal status, even on an unexpected throw.
 */
export async function startReproduction(
  incidentId: string,
  llmOverride?: InvestigationLLM,
): Promise<{ id: string; status: ReproductionStatus }> {
  if (process.env.REPRODUCTION_ENABLED === 'false') {
    throw new ReproductionPreconditionError('REPRODUCTION_DISABLED', 'Reproduction is disabled on this server.');
  }

  const { investigation, targetCommitSha } = await loadPreconditionData(incidentId);

  const run = await prisma.reproductionRun.create({
    data: {
      incidentId,
      investigationId: investigation!.id,
      status: ReproductionStatus.GENERATING_TEST,
      targetCommitSha,
      startedAt: new Date(),
    },
  });

  log('reproduction_started', { incidentId, runId: run.id });

  void executeReproduction(run.id, llmOverride).catch((err) => {
    log('reproduction_unhandled_error', { runId: run.id, message: err instanceof Error ? err.message : String(err) });
  });

  return { id: run.id, status: run.status };
}

async function executeReproduction(runId: string, llmOverride?: InvestigationLLM): Promise<void> {
  const run = await prisma.reproductionRun.findUniqueOrThrow({ where: { id: runId } });

  try {
    const { incident, codeContext, investigation, repository } = await loadPreconditionData(run.incidentId);
    const accessToken = decryptToken(repository!.encryptedAccessToken);
    const testGenerationInput = await buildTestGenerationInput(incident, investigation, codeContext, repository!, accessToken);

    const model = process.env.INVESTIGATION_MODEL ?? DEFAULT_MODEL;
    const llm = llmOverride ?? createOpenAILLM({ apiKey: requireEnv('OPENAI_API_KEY'), model });

    const stageToStatus: Record<ReproductionEngineStage, ReproductionStatus> = {
      GENERATING_TEST: ReproductionStatus.GENERATING_TEST,
      CREATING_SANDBOX: ReproductionStatus.CREATING_SANDBOX,
      CHECKING_OUT: ReproductionStatus.CHECKING_OUT,
      INSTALLING: ReproductionStatus.INSTALLING,
      RUNNING: ReproductionStatus.RUNNING,
      CLASSIFYING: ReproductionStatus.CLASSIFYING,
    };

    const startedAt = Date.now();
    const engineResult = await runReproduction(
      {
        targetCommitSha: run.targetCommitSha!,
        repositoryUrl: repository!.repositoryUrl,
        accessToken,
        testGenerationInput,
      },
      {
        llm,
        onStage: async (stage) => {
          log(`reproduction_stage_${stage.toLowerCase()}`, { runId, incidentId: run.incidentId });
          await prisma.reproductionRun.update({ where: { id: runId }, data: { status: stageToStatus[stage] } }).catch(() => {});
        },
      },
    );
    const durationMs = Date.now() - startedAt;

    await persistReproductionResult(runId, engineResult);
    log('reproduction_completed', { runId, result: engineResult.result, status: engineResult.status, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected reproduction failure';
    await prisma.reproductionRun.update({
      where: { id: runId },
      data: { status: ReproductionStatus.FAILED, completedAt: new Date(), errorMessage: message },
    });
    log('reproduction_completed', { runId, result: null, status: 'FAILED', errorMessage: message });
  }
}

async function persistReproductionResult(runId: string, result: ReproductionEngineResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.reproductionRun.update({
      where: { id: runId },
      data: {
        status: result.status === 'COMPLETED' ? ReproductionStatus.COMPLETED : ReproductionStatus.FAILED,
        result: result.result as ReproductionResult | null,
        generatedTest: result.test?.content ?? null,
        testFilePath: result.test?.filePath ?? null,
        testExplanation: result.test?.explanation ?? null,
        targetCommitSha: result.targetCommitSha,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        exitCode: result.exitCode,
        durationMs: result.durationMs || null,
        errorMessage: result.errorMessage,
        completedAt: new Date(),
      },
    });

    if (result.test) {
      await tx.reproductionTest.create({
        data: {
          reproductionRunId: runId,
          filePath: result.test.filePath,
          testName: result.test.testName,
          language: result.test.language,
          framework: result.test.framework,
          content: result.test.content,
          explanation: result.test.explanation,
        },
      });
    }
  });
}

const REPRODUCTION_RUN_SELECT = {
  id: true,
  incidentId: true,
  investigationId: true,
  status: true,
  result: true,
  targetCommitSha: true,
  testFilePath: true,
  generatedTest: true,
  testExplanation: true,
  stdout: true,
  stderr: true,
  exitCode: true,
  durationMs: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.ReproductionRunSelect;

export async function getReproductionRun(id: string) {
  const run = await prisma.reproductionRun.findUnique({ where: { id }, select: REPRODUCTION_RUN_SELECT });
  if (!run) throw notFound('Reproduction run not found');
  return run;
}

export async function listIncidentReproductionRuns(incidentId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  return prisma.reproductionRun.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
    select: REPRODUCTION_RUN_SELECT,
  });
}
