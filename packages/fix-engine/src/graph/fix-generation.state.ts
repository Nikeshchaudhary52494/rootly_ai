import { Annotation } from '@langchain/langgraph';
import type { FixAnalysis } from '../schemas/fix-analysis.schema';
import type { FixProposal } from '../schemas/fix-proposal.schema';

export interface FixGenerationIncident {
  errorName: string;
  errorMessage: string;
  stackTrace: string | null;
}

export interface FixGenerationInvestigation {
  rootCause: string;
  confidence: number | null;
  recommendation: string | null;
  evidenceDescriptions: string[];
}

export interface FixGenerationReproduction {
  generatedTest: string;
  testFilePath: string;
  result: string;
  stdout: string;
  stderr: string;
}

export interface FixGenerationCodeFile {
  filePath: string;
  functionName: string | null;
  content: string;
  contentStartLine: number;
  contentEndLine: number;
}

export interface FixGenerationTestFile {
  filePath: string;
  content: string;
}

export interface FixGenerationCodeContext {
  primaryFilePath: string;
  primaryLineNumber: number | null;
  files: FixGenerationCodeFile[];
  relatedTests: FixGenerationTestFile[];
  recentCommits: Array<{ sha: string; message: string }>;
}

export interface FixGenerationInput {
  incident: FixGenerationIncident;
  investigation: FixGenerationInvestigation;
  reproduction: FixGenerationReproduction;
  codeContext: FixGenerationCodeContext;
}

export type FixGenerationStatus = 'RUNNING' | 'ANALYZING' | 'GENERATING_PATCH' | 'VALIDATING' | 'COMPLETED' | 'FAILED';

function overwrite<T>() {
  return { reducer: (_current: T, update: T) => update };
}

export const FixGenerationAnnotation = Annotation.Root({
  input: Annotation<FixGenerationInput | null>({ ...overwrite<FixGenerationInput | null>(), default: () => null }),
  analysis: Annotation<FixAnalysis | null>({ ...overwrite<FixAnalysis | null>(), default: () => null }),
  proposal: Annotation<FixProposal | null>({ ...overwrite<FixProposal | null>(), default: () => null }),
  status: Annotation<FixGenerationStatus>({ ...overwrite<FixGenerationStatus>(), default: () => 'RUNNING' }),
  errors: Annotation<string[]>({ reducer: (current: string[], update: string[]) => current.concat(update), default: () => [] }),
  usage: Annotation<{ inputTokens: number; outputTokens: number; totalTokens: number }>({
    reducer: (current, update) => ({
      inputTokens: current.inputTokens + update.inputTokens,
      outputTokens: current.outputTokens + update.outputTokens,
      totalTokens: current.totalTokens + update.totalTokens,
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  }),
});

export type FixGenerationState = typeof FixGenerationAnnotation.State;
export type FixGenerationStateUpdate = typeof FixGenerationAnnotation.Update;
