import { Annotation } from '@langchain/langgraph';
import type { ErrorAnalysis, CodeAnalysis, HistoryAnalysis, EvidenceCandidate, ResolvedEvidence } from '../schemas/investigation.schema';
import type { LLMUsage } from '../llm/llm.client';

// --- What apps/api hands the agent. Plain data — no Prisma types leak in here. ---

export interface InvestigationIncident {
  id: string;
  title: string;
  errorName: string;
  errorMessage: string;
  status: string;
  occurrenceCount: number;
}

export interface InvestigationEvent {
  errorName: string;
  errorMessage: string;
  stackTrace: string | null;
  serviceName: string;
  environmentName: string;
  release: string | null;
  timestamp: string;
}

export interface InvestigationCodeFile {
  filePath: string;
  functionName: string | null;
  lineNumber: number | null;
  contentStartLine: number;
  contentEndLine: number;
  content: string;
  isPrimary: boolean;
}

export interface InvestigationTestFile {
  filePath: string;
  content: string;
}

export interface InvestigationCommit {
  sha: string;
  message: string;
  authorName: string;
  committedAt: string;
}

export interface InvestigationCodeContext {
  status: string;
  primaryLocation: { filePath: string; lineNumber: number | null } | null;
  files: InvestigationCodeFile[];
  relatedTests: InvestigationTestFile[];
  recentCommits: InvestigationCommit[];
}

export interface InvestigationInput {
  incident: InvestigationIncident;
  latestEvent: InvestigationEvent | null;
  codeContext: InvestigationCodeContext | null;
  repository: { owner: string; name: string; defaultBranch: string } | null;
}

// --- Hypothesis + evidence shape the graph produces, ready for persistence ---

export interface InvestigationHypothesisResult {
  title: string;
  description: string;
  confidence: number;
  status: 'LIKELY' | 'POSSIBLE' | 'REJECTED';
  rank: number;
  supportingEvidence: ResolvedEvidence[];
  contradictingEvidence: ResolvedEvidence[];
}

export interface InvestigationFinalReport {
  summary: string;
  rootCause: string;
  confidence: number;
  impact: string;
  affectedComponent: string;
  primaryLocation: { file: string; line: number | null } | null;
  recommendation: string;
}

export type InvestigationRunStatus =
  | 'RUNNING'
  | 'LOADING_CONTEXT'
  | 'ANALYZING_ERROR'
  | 'ANALYZING_CODE'
  | 'ANALYZING_HISTORY'
  | 'GENERATING_HYPOTHESES'
  | 'EVALUATING_EVIDENCE'
  | 'GENERATING_REPORT'
  | 'COMPLETED'
  | 'FAILED';

function overwrite<T>() {
  return { reducer: (_current: T, update: T) => update };
}

export const InvestigationAnnotation = Annotation.Root({
  investigationId: Annotation<string>,
  incidentId: Annotation<string>,

  input: Annotation<InvestigationInput | null>({ ...overwrite<InvestigationInput | null>(), default: () => null }),
  evidencePool: Annotation<EvidenceCandidate[]>({ ...overwrite<EvidenceCandidate[]>(), default: () => [] }),

  errorAnalysis: Annotation<ErrorAnalysis | null>({ ...overwrite<ErrorAnalysis | null>(), default: () => null }),
  codeAnalysis: Annotation<CodeAnalysis | null>({ ...overwrite<CodeAnalysis | null>(), default: () => null }),
  historyAnalysis: Annotation<HistoryAnalysis | null>({ ...overwrite<HistoryAnalysis | null>(), default: () => null }),

  hypotheses: Annotation<InvestigationHypothesisResult[]>({
    ...overwrite<InvestigationHypothesisResult[]>(),
    default: () => [],
  }),
  finalReport: Annotation<InvestigationFinalReport | null>({
    ...overwrite<InvestigationFinalReport | null>(),
    default: () => null,
  }),

  status: Annotation<InvestigationRunStatus>({ ...overwrite<InvestigationRunStatus>(), default: () => 'RUNNING' }),
  errors: Annotation<string[]>({ reducer: (current: string[], update: string[]) => current.concat(update), default: () => [] }),
  usage: Annotation<LLMUsage>({
    reducer: (current: LLMUsage, update: LLMUsage) => ({
      inputTokens: current.inputTokens + update.inputTokens,
      outputTokens: current.outputTokens + update.outputTokens,
      totalTokens: current.totalTokens + update.totalTokens,
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  }),
});

export type InvestigationState = typeof InvestigationAnnotation.State;
export type InvestigationStateUpdate = typeof InvestigationAnnotation.Update;
