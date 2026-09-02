import { prisma } from '../prisma';
import { notFound } from '../errors';
import {
  InvestigationStatus,
  HypothesisStatus,
  EvidenceType,
  EvidenceSourceType,
  Prisma,
} from '../generated/prisma/client';
import {
  runInvestigation,
  createOpenAILLM,
  type InvestigationInput,
  type InvestigationLLM,
  type InvestigationRunResult,
} from '@incident-ai/agent';

const DEFAULT_MODEL = 'gpt-4o-mini';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function buildInvestigationInput(incidentId: string): Promise<InvestigationInput> {
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
  const latestEvent = await prisma.errorEvent.findUnique({ where: { id: incident.latestEventId } });

  const codeContext = await prisma.incidentCodeContext.findUnique({
    where: { incidentId },
    include: { files: true, commits: { orderBy: { committedAt: 'desc' } } },
  });

  const repository = codeContext?.repositoryId
    ? await prisma.repository.findUnique({
        where: { id: codeContext.repositoryId },
        select: { owner: true, name: true, defaultBranch: true },
      })
    : null;

  return {
    incident: {
      id: incident.id,
      title: incident.title,
      errorName: incident.errorName,
      errorMessage: incident.errorMessage,
      status: incident.status,
      occurrenceCount: incident.occurrenceCount,
    },
    latestEvent: latestEvent
      ? {
          errorName: latestEvent.errorName,
          errorMessage: latestEvent.errorMessage,
          stackTrace: latestEvent.stackTrace,
          serviceName: latestEvent.serviceName,
          environmentName: latestEvent.environmentName,
          release: latestEvent.release,
          timestamp: latestEvent.timestamp.toISOString(),
        }
      : null,
    codeContext: codeContext
      ? {
          status: codeContext.status,
          primaryLocation: codeContext.primaryFilePath
            ? { filePath: codeContext.primaryFilePath, lineNumber: codeContext.primaryLineNumber }
            : null,
          files: codeContext.files
            .filter((f) => f.isPrimary)
            .map((f) => ({
              filePath: f.filePath,
              functionName: f.functionName,
              lineNumber: f.lineNumber,
              contentStartLine: f.contentStartLine,
              contentEndLine: f.contentEndLine,
              content: f.content,
              isPrimary: f.isPrimary,
            })),
          relatedTests: codeContext.files
            .filter((f) => !f.isPrimary)
            .map((f) => ({ filePath: f.filePath, content: f.content })),
          recentCommits: codeContext.commits.map((c) => ({
            sha: c.sha,
            message: c.message,
            authorName: c.authorName,
            committedAt: c.committedAt.toISOString(),
          })),
        }
      : null,
    repository: repository
      ? { owner: repository.owner, name: repository.name, defaultBranch: repository.defaultBranch }
      : null,
  };
}

/** Structured, secret-free observability line — never includes the API key or repository token. */
function logInvestigation(fields: {
  investigationId: string;
  incidentId: string;
  model: string;
  status: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}) {
  console.log(JSON.stringify({ event: 'investigation_run', ...fields }));
}

async function persistResult(investigationId: string, result: InvestigationRunResult) {
  await prisma.$transaction(async (tx) => {
    await tx.investigation.update({
      where: { id: investigationId },
      data: {
        status: result.status === 'COMPLETED' ? InvestigationStatus.COMPLETED : InvestigationStatus.FAILED,
        completedAt: new Date(),
        finalConfidence: result.finalConfidence,
        summary: result.summary,
        recommendation: result.finalReport?.recommendation ?? null,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        errorMessage: result.errors.length ? result.errors.join(' | ') : null,
      },
    });

    for (const hypothesis of result.hypotheses) {
      const created = await tx.investigationHypothesis.create({
        data: {
          investigationId,
          title: hypothesis.title,
          description: hypothesis.description,
          confidence: hypothesis.confidence,
          rank: hypothesis.rank,
          status: hypothesis.status as HypothesisStatus,
        },
      });

      const evidenceData: Prisma.InvestigationEvidenceCreateManyInput[] = [
        ...hypothesis.supportingEvidence,
        ...hypothesis.contradictingEvidence,
      ].map((e) => ({
        investigationId,
        hypothesisId: created.id,
        type: e.type as EvidenceType,
        description: e.description,
        sourceType: e.sourceType as EvidenceSourceType,
        sourceReference: e.sourceReference,
        lineStart: e.lineStart,
        lineEnd: e.lineEnd,
        confidence: e.confidence,
      }));

      if (evidenceData.length > 0) {
        await tx.investigationEvidence.createMany({ data: evidenceData });
      }
    }
  });
}

/**
 * Starts and (for this MVP) synchronously runs an investigation, persisting
 * the full result. Kept as a single async function — not tied to the HTTP
 * request lifecycle — so it drops behind a queue/worker later without callers changing.
 */
export async function startInvestigation(
  incidentId: string,
  llmOverride?: InvestigationLLM,
): Promise<{ investigationId: string; status: InvestigationStatus }> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  const model = process.env.INVESTIGATION_MODEL ?? DEFAULT_MODEL;

  const investigation = await prisma.investigation.create({
    data: { incidentId, status: InvestigationStatus.RUNNING, startedAt: new Date(), model },
  });

  try {
    const input = await buildInvestigationInput(incidentId);
    const llm = llmOverride ?? createOpenAILLM({ apiKey: requireEnv('OPENAI_API_KEY'), model });

    const startedAt = Date.now();
    const result = await runInvestigation(investigation.id, incidentId, input, { llm });
    const durationMs = Date.now() - startedAt;

    logInvestigation({
      investigationId: investigation.id,
      incidentId,
      model,
      status: result.status,
      durationMs,
      usage: result.usage,
    });

    await persistResult(investigation.id, result);

    return { investigationId: investigation.id, status: result.status as InvestigationStatus };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected investigation failure';
    await prisma.investigation.update({
      where: { id: investigation.id },
      data: { status: InvestigationStatus.FAILED, completedAt: new Date(), errorMessage: message },
    });
    return { investigationId: investigation.id, status: InvestigationStatus.FAILED };
  }
}

export async function getInvestigation(investigationId: string) {
  const investigation = await prisma.investigation.findUnique({
    where: { id: investigationId },
    include: {
      hypotheses: { orderBy: { rank: 'asc' } },
      evidence: true,
    },
  });
  if (!investigation) throw notFound('Investigation not found');

  return {
    id: investigation.id,
    incidentId: investigation.incidentId,
    status: investigation.status,
    model: investigation.model,
    summary: investigation.summary,
    recommendation: investigation.recommendation,
    finalConfidence: investigation.finalConfidence,
    errorMessage: investigation.errorMessage,
    usage: {
      inputTokens: investigation.inputTokens,
      outputTokens: investigation.outputTokens,
      totalTokens: investigation.totalTokens,
    },
    hypotheses: investigation.hypotheses.map((h) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      confidence: h.confidence,
      rank: h.rank,
      status: h.status,
    })),
    evidence: investigation.evidence.map((e) => ({
      id: e.id,
      hypothesisId: e.hypothesisId,
      type: e.type,
      description: e.description,
      sourceType: e.sourceType,
      sourceReference: e.sourceReference,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      confidence: e.confidence,
    })),
    createdAt: investigation.createdAt,
    startedAt: investigation.startedAt,
    completedAt: investigation.completedAt,
  };
}

export async function listIncidentInvestigations(incidentId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  const investigations = await prisma.investigation.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
  });

  return investigations.map((inv) => ({
    id: inv.id,
    status: inv.status,
    model: inv.model,
    finalConfidence: inv.finalConfidence,
    summary: inv.summary,
    createdAt: inv.createdAt,
    completedAt: inv.completedAt,
  }));
}
