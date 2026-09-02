import { buildInvestigationGraph } from './graph/investigation.graph';
import type {
  InvestigationInput,
  InvestigationHypothesisResult,
  InvestigationFinalReport,
} from './graph/investigation.state';
import type { ErrorAnalysis, CodeAnalysis, HistoryAnalysis } from './schemas/investigation.schema';
import type { InvestigationLLM, LLMUsage } from './llm/llm.client';
import { OpenAIInvestigationLLM } from './llm/llm.client';

export type { InvestigationLLM, LLMUsage, StructuredLLMRequest, StructuredLLMResponse } from './llm/llm.client';
export { OpenAIInvestigationLLM } from './llm/llm.client';
export type {
  InvestigationInput,
  InvestigationIncident,
  InvestigationEvent,
  InvestigationCodeContext,
  InvestigationCodeFile,
  InvestigationTestFile,
  InvestigationCommit,
  InvestigationHypothesisResult,
  InvestigationFinalReport,
  InvestigationRunStatus,
} from './graph/investigation.state';
export type { ErrorAnalysis, CodeAnalysis, HistoryAnalysis, ResolvedEvidence, EvidenceType, EvidenceSourceType } from './schemas/investigation.schema';
export { getIncidentContext } from './tools/incident-context.tool';
export { getFileContext } from './tools/file-context.tool';
export { searchRepository } from './tools/repository-search.tool';
export { getGitHistory } from './tools/git-history.tool';

export interface InvestigationRunResult {
  status: 'COMPLETED' | 'FAILED';
  errorAnalysis: ErrorAnalysis | null;
  codeAnalysis: CodeAnalysis | null;
  historyAnalysis: HistoryAnalysis | null;
  hypotheses: InvestigationHypothesisResult[];
  finalReport: InvestigationFinalReport | null;
  finalConfidence: number | null;
  summary: string | null;
  usage: LLMUsage;
  errors: string[];
}

export interface RunInvestigationOptions {
  llm: InvestigationLLM;
}

/** Convenience factory: builds the default OpenAI-backed LLM from env-style config. */
export function createOpenAILLM(config: { apiKey: string; model: string }): InvestigationLLM {
  return new OpenAIInvestigationLLM(config);
}

/**
 * Runs the full LangGraph investigation pipeline for one incident and
 * returns a plain result ready for apps/api to persist. Never throws —
 * an unexpected exception anywhere in the graph is caught and reported as
 * a FAILED run so a caller can never be left polling a stuck investigation.
 */
export async function runInvestigation(
  investigationId: string,
  incidentId: string,
  input: InvestigationInput,
  options: RunInvestigationOptions,
): Promise<InvestigationRunResult> {
  const graph = buildInvestigationGraph(options.llm);

  try {
    const finalState = await graph.invoke({
      investigationId,
      incidentId,
      input,
      status: 'RUNNING',
    });

    const status = finalState.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
    const topHypothesis = finalState.hypotheses[0] ?? null;

    return {
      status,
      errorAnalysis: finalState.errorAnalysis,
      codeAnalysis: finalState.codeAnalysis,
      historyAnalysis: finalState.historyAnalysis,
      hypotheses: finalState.hypotheses,
      finalReport: finalState.finalReport,
      finalConfidence: finalState.finalReport?.confidence ?? topHypothesis?.confidence ?? null,
      summary: finalState.finalReport?.summary ?? null,
      usage: finalState.usage,
      errors: finalState.errors,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      errorAnalysis: null,
      codeAnalysis: null,
      historyAnalysis: null,
      hypotheses: [],
      finalReport: null,
      finalConfidence: null,
      summary: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      errors: [err instanceof Error ? err.message : 'Unexpected investigation failure'],
    };
  }
}
