import { z } from 'zod';

// --- Shared enums (mirror the Prisma enums apps/api persists these as) ---

export const EvidenceTypeSchema = z.enum(['SUPPORTING', 'CONTRADICTING']);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceSourceTypeSchema = z.enum([
  'ERROR',
  'SOURCE_CODE',
  'STACK_TRACE',
  'TEST',
  'GIT_COMMIT',
  'CONFIGURATION',
]);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const HypothesisStatusSchema = z.enum(['LIKELY', 'POSSIBLE', 'REJECTED']);
export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

// --- Node 2: error analysis ---

export const ErrorAnalysisSchema = z.object({
  errorType: z.string().min(1),
  normalizedMessage: z.string().min(1),
  primaryLocation: z.object({ file: z.string().min(1), line: z.number().int().positive() }).nullable(),
  observations: z.array(z.string().min(1)).max(10),
});
export type ErrorAnalysis = z.infer<typeof ErrorAnalysisSchema>;

// --- Node 3: code analysis ---

export const CodeObservationSchema = z.object({
  description: z.string().min(1),
  sourceFile: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
});
export type CodeObservation = z.infer<typeof CodeObservationSchema>;

export const CodeAnalysisSchema = z.object({
  observations: z.array(CodeObservationSchema).max(15),
});
export type CodeAnalysis = z.infer<typeof CodeAnalysisSchema>;

// --- Node 4: history analysis ---

export const HistoryObservationSchema = z.object({
  commitSha: z.string().min(1),
  description: z.string().min(1),
  relevance: z.number().min(0).max(1),
});
export type HistoryObservation = z.infer<typeof HistoryObservationSchema>;

export const HistoryAnalysisSchema = z.object({
  observations: z.array(HistoryObservationSchema).max(10),
});
export type HistoryAnalysis = z.infer<typeof HistoryAnalysisSchema>;

// --- Node 5: hypothesis generation ---

export const HypothesisDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type HypothesisDraft = z.infer<typeof HypothesisDraftSchema>;

export const HypothesesSchema = z.object({
  hypotheses: z.array(HypothesisDraftSchema).min(1).max(3),
});
export type Hypotheses = z.infer<typeof HypothesesSchema>;

// --- Node 6: evidence evaluation ---
// The LLM only ever cites evidence *ids* drawn from a pool built deterministically
// from validated analysis output (see evidence-pool.ts) — it never re-emits raw
// file paths, line numbers, or commit shas at this stage.

export const HypothesisEvaluationSchema = z.object({
  hypothesisIndex: z.number().int().min(0),
  supportingEvidenceIds: z.array(z.string()).max(10),
  contradictingEvidenceIds: z.array(z.string()).max(10),
  missingEvidence: z.array(z.string()).max(5),
  revisedConfidence: z.number().min(0).max(1),
  status: HypothesisStatusSchema,
});
export type HypothesisEvaluation = z.infer<typeof HypothesisEvaluationSchema>;

export const EvidenceEvaluationSchema = z.object({
  evaluations: z.array(HypothesisEvaluationSchema).min(1).max(3),
});
export type EvidenceEvaluation = z.infer<typeof EvidenceEvaluationSchema>;

// --- Node 7: final report ---
// confidence, affectedComponent, and primaryLocation are derived deterministically
// from already-validated state rather than asked of the model — see generate-report.node.ts.

export const FinalReportDraftSchema = z.object({
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  impact: z.string().min(1),
  recommendation: z.string().min(1),
});
export type FinalReportDraft = z.infer<typeof FinalReportDraftSchema>;

// --- Evidence pool item: a single citable, pre-validated fact ---

export interface EvidenceCandidate {
  id: string;
  type: EvidenceSourceType;
  description: string;
  sourceReference: string;
  lineStart: number | null;
  lineEnd: number | null;
}

// --- Resolved evidence attached to a persisted hypothesis ---

export interface ResolvedEvidence {
  type: EvidenceType;
  description: string;
  sourceType: EvidenceSourceType;
  sourceReference: string;
  lineStart: number | null;
  lineEnd: number | null;
  confidence: number;
}
