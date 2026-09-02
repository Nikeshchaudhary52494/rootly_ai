import { prisma } from '../prisma';
import { notFound } from '../errors';
import { FixStatus, FixResult, Prisma } from '../generated/prisma/client';
import { decryptToken } from '../github/utils/github-token-crypto';
import {
  runFixAttempt,
  DEFAULT_PATCH_SAFETY_LIMITS,
  type FixEngineResult,
  type FixEngineStage,
  type FixGenerationInput,
  type PatchSafetyLimits,
} from '@rootly.ai/fix-engine';
import { createOpenAILLM, type InvestigationLLM } from '@rootly.ai/agent';
import { computePatchHash } from '@rootly.ai/github';

const DEFAULT_MODEL = 'gpt-4o-mini';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadPatchLimits(): PatchSafetyLimits {
  return {
    maxFiles: parsePositiveInt(process.env.FIX_MAX_FILES, DEFAULT_PATCH_SAFETY_LIMITS.maxFiles),
    maxChangedLines: parsePositiveInt(process.env.FIX_MAX_CHANGED_LINES, DEFAULT_PATCH_SAFETY_LIMITS.maxChangedLines),
    maxPatchBytes: parsePositiveInt(process.env.FIX_MAX_PATCH_BYTES, DEFAULT_PATCH_SAFETY_LIMITS.maxPatchBytes),
  };
}

export class FixPreconditionError extends Error {
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

  const precondition = 'A confirmed reproduction is required before generating a fix.';

  const codeContext = await prisma.incidentCodeContext.findUnique({
    where: { incidentId },
    include: { files: true, commits: { orderBy: { committedAt: 'desc' } } },
  });
  if (!codeContext || codeContext.status !== 'READY') {
    throw new FixPreconditionError('FIX_PRECONDITION_FAILED', precondition);
  }

  const repository = codeContext.repositoryId
    ? await prisma.repository.findUnique({ where: { id: codeContext.repositoryId } })
    : null;
  if (!repository) {
    throw new FixPreconditionError('FIX_PRECONDITION_FAILED', precondition);
  }

  const investigation = await prisma.investigation.findFirst({
    where: { incidentId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    include: { hypotheses: { orderBy: { rank: 'asc' } }, evidence: true },
  });
  if (!investigation || !investigation.summary || investigation.finalConfidence == null) {
    throw new FixPreconditionError('FIX_PRECONDITION_FAILED', precondition);
  }
  if (investigation.hypotheses.length === 0 || investigation.evidence.length === 0) {
    throw new FixPreconditionError('FIX_PRECONDITION_FAILED', precondition);
  }
  if (!codeContext.primaryFilePath || codeContext.primaryLineNumber == null) {
    throw new FixPreconditionError('FIX_PRECONDITION_FAILED', precondition);
  }

  const reproductionRun = await prisma.reproductionRun.findFirst({
    where: { incidentId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!reproductionRun || reproductionRun.result !== 'REPRODUCED' || !reproductionRun.generatedTest || !reproductionRun.testFilePath) {
    throw new FixPreconditionError('FIX_PRECONDITION_FAILED', precondition);
  }

  return { incident, codeContext, repository, investigation, reproductionRun };
}

async function buildFixGenerationInput(
  incident: NonNullable<Awaited<ReturnType<typeof loadPreconditionData>>['incident']>,
  investigation: Awaited<ReturnType<typeof loadPreconditionData>>['investigation'],
  reproductionRun: Awaited<ReturnType<typeof loadPreconditionData>>['reproductionRun'],
  codeContext: Awaited<ReturnType<typeof loadPreconditionData>>['codeContext'],
): Promise<FixGenerationInput> {
  const latestEvent = await prisma.errorEvent.findUnique({ where: { id: incident.latestEventId } });

  return {
    incident: {
      errorName: incident.errorName,
      errorMessage: incident.errorMessage,
      stackTrace: latestEvent?.stackTrace ?? null,
    },
    investigation: {
      rootCause: investigation!.summary!,
      confidence: investigation!.finalConfidence,
      recommendation: investigation!.recommendation,
      evidenceDescriptions: investigation!.evidence.map((e) => e.description),
    },
    reproduction: {
      generatedTest: reproductionRun!.generatedTest!,
      testFilePath: reproductionRun!.testFilePath!,
      result: reproductionRun!.result!,
      stdout: reproductionRun!.stdout ?? '',
      stderr: reproductionRun!.stderr ?? '',
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
      recentCommits: codeContext!.commits.map((c) => ({ sha: c.sha, message: c.message })),
    },
  };
}

/**
 * Validates preconditions, creates the FixAttempt record, and kicks off the
 * (potentially 30-120s) validation pipeline without blocking the request —
 * see executeFixAttempt, which persists status after every stage and always
 * resolves the attempt out of a non-terminal status, even on an unexpected throw.
 */
export async function startFixAttempt(
  incidentId: string,
  llmOverride?: InvestigationLLM,
): Promise<{ id: string; status: FixStatus }> {
  if (process.env.FIX_ENABLED === 'false') {
    throw new FixPreconditionError('FIX_DISABLED', 'Fix generation is disabled on this server.');
  }

  const { investigation, reproductionRun } = await loadPreconditionData(incidentId);

  const attempt = await prisma.fixAttempt.create({
    data: {
      incidentId,
      investigationId: investigation.id,
      reproductionRunId: reproductionRun.id,
      status: FixStatus.GENERATING_FIX,
      targetCommitSha: reproductionRun.targetCommitSha,
      startedAt: new Date(),
    },
  });

  log('fix_started', { incidentId, fixAttemptId: attempt.id });

  void executeFixAttempt(attempt.id, llmOverride).catch((err) => {
    log('fix_unhandled_error', { fixAttemptId: attempt.id, message: err instanceof Error ? err.message : String(err) });
  });

  return { id: attempt.id, status: attempt.status };
}

async function executeFixAttempt(fixAttemptId: string, llmOverride?: InvestigationLLM): Promise<void> {
  const attempt = await prisma.fixAttempt.findUniqueOrThrow({ where: { id: fixAttemptId } });

  try {
    const { incident, codeContext, repository, investigation, reproductionRun } = await loadPreconditionData(attempt.incidentId);
    const accessToken = decryptToken(repository.encryptedAccessToken);
    const fixGenerationInput = await buildFixGenerationInput(incident, investigation, reproductionRun, codeContext);

    const model = process.env.INVESTIGATION_MODEL ?? DEFAULT_MODEL;
    const llm = llmOverride ?? createOpenAILLM({ apiKey: requireEnv('OPENAI_API_KEY'), model });

    const stageToStatus: Record<FixEngineStage, FixStatus> = {
      GENERATING_FIX: FixStatus.GENERATING_FIX,
      VALIDATING_PATCH: FixStatus.VALIDATING_PATCH,
      CREATING_SANDBOX: FixStatus.CREATING_SANDBOX,
      CHECKING_OUT: FixStatus.CHECKING_OUT,
      APPLYING_PATCH: FixStatus.APPLYING_PATCH,
      RUNNING_REPRODUCTION: FixStatus.RUNNING_REPRODUCTION,
      RUNNING_REGRESSION_TESTS: FixStatus.RUNNING_REGRESSION_TESTS,
      VALIDATING: FixStatus.VALIDATING,
    };

    const startedAt = Date.now();
    const engineResult = await runFixAttempt(
      {
        targetCommitSha: reproductionRun.targetCommitSha!,
        repositoryUrl: repository.repositoryUrl,
        accessToken,
        fixGenerationInput,
      },
      {
        llm,
        patchLimits: loadPatchLimits(),
        onStage: async (stage) => {
          log(`fix_stage_${stage.toLowerCase()}`, { fixAttemptId, incidentId: attempt.incidentId });
          await prisma.fixAttempt.update({ where: { id: fixAttemptId }, data: { status: stageToStatus[stage] } }).catch(() => {});
        },
      },
    );
    const durationMs = Date.now() - startedAt;

    await persistFixResult(fixAttemptId, engineResult);
    log('fix_completed', { fixAttemptId, result: engineResult.result, status: engineResult.status, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected fix attempt failure';
    await prisma.fixAttempt.update({
      where: { id: fixAttemptId },
      data: { status: FixStatus.FAILED, completedAt: new Date(), errorMessage: message },
    });
    log('fix_completed', { fixAttemptId, result: null, status: 'FAILED', errorMessage: message });
  }
}

async function persistFixResult(fixAttemptId: string, result: FixEngineResult): Promise<void> {
  const patch = result.patches.length ? result.patches.map((p) => p.diff).join('\n\n') : null;

  await prisma.$transaction(async (tx) => {
    await tx.fixAttempt.update({
      where: { id: fixAttemptId },
      data: {
        status: result.status === 'COMPLETED' ? FixStatus.COMPLETED : FixStatus.FAILED,
        result: result.result as FixResult | null,
        targetCommitSha: result.targetCommitSha,
        patch,
        // Fingerprints the exact bytes that passed Phase 7 validation — Phase 8 recomputes
        // this at promotion time and refuses to push if it no longer matches (see
        // pull-requests.service.ts's PATCH_INTEGRITY_FAILED check).
        validatedPatchHash: patch ? computePatchHash(patch) : null,
        changedFiles: result.patches.map((p) => p.filePath),
        explanation: result.proposal?.summary ?? null,
        validationSummary: (result.validationSummary as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        errorMessage: result.errorMessage,
        completedAt: new Date(),
      },
    });

    if (result.patches.length > 0) {
      await tx.fixPatch.createMany({
        data: result.patches.map((p) => ({
          fixAttemptId,
          filePath: p.filePath,
          originalContent: p.originalContent,
          patchedContent: p.patchedContent,
          diff: p.diff,
        })),
      });
    }
  });
}

const FIX_ATTEMPT_SELECT = {
  id: true,
  incidentId: true,
  investigationId: true,
  reproductionRunId: true,
  status: true,
  result: true,
  targetCommitSha: true,
  patch: true,
  changedFiles: true,
  explanation: true,
  validationSummary: true,
  stdout: true,
  stderr: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.FixAttemptSelect;

export async function getFixAttempt(id: string) {
  const attempt = await prisma.fixAttempt.findUnique({
    where: { id },
    select: { ...FIX_ATTEMPT_SELECT, patches: { select: { filePath: true, diff: true } } },
  });
  if (!attempt) throw notFound('Fix attempt not found');
  return attempt;
}

export async function listIncidentFixAttempts(incidentId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  return prisma.fixAttempt.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
    select: FIX_ATTEMPT_SELECT,
  });
}
