import { Annotation } from '@langchain/langgraph';
import type { FailureUnderstanding } from '../schemas/failure-understanding.schema';
import type { ReproductionTest } from '../schemas/reproduction.schema';

export interface GenerationIncident {
  errorName: string;
  errorMessage: string;
  occurrenceCount: number;
}

export interface GenerationEvent {
  stackTrace: string | null;
  errorMessage: string;
}

export interface GenerationHypothesis {
  title: string;
  description: string;
  confidence: number;
  status: string;
}

export interface GenerationInvestigation {
  summary: string | null;
  rootCause: string;
  recommendation: string | null;
  confidence: number | null;
  hypotheses: GenerationHypothesis[];
}

export interface GenerationCodeFile {
  filePath: string;
  functionName: string | null;
  content: string;
  contentStartLine: number;
  contentEndLine: number;
}

export interface GenerationTestFile {
  filePath: string;
  content: string;
}

export interface GenerationCodeContext {
  primaryFilePath: string;
  primaryLineNumber: number | null;
  files: GenerationCodeFile[];
  relatedTests: GenerationTestFile[];
}

export interface TestGenerationInput {
  incident: GenerationIncident;
  latestEvent: GenerationEvent | null;
  investigation: GenerationInvestigation;
  codeContext: GenerationCodeContext;
  /** Best-effort, may be absent — helps the model match module conventions (CJS vs ESM). */
  packageJsonContent: string | null;
}

export type TestGenerationStatus =
  | 'RUNNING'
  | 'UNDERSTANDING_FAILURE'
  | 'GENERATING_TEST'
  | 'VALIDATING_TEST'
  | 'COMPLETED'
  | 'FAILED';

function overwrite<T>() {
  return { reducer: (_current: T, update: T) => update };
}

export const TestGenerationAnnotation = Annotation.Root({
  input: Annotation<TestGenerationInput | null>({ ...overwrite<TestGenerationInput | null>(), default: () => null }),
  understanding: Annotation<FailureUnderstanding | null>({
    ...overwrite<FailureUnderstanding | null>(),
    default: () => null,
  }),
  test: Annotation<ReproductionTest | null>({ ...overwrite<ReproductionTest | null>(), default: () => null }),
  status: Annotation<TestGenerationStatus>({ ...overwrite<TestGenerationStatus>(), default: () => 'RUNNING' }),
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

export type TestGenerationState = typeof TestGenerationAnnotation.State;
export type TestGenerationStateUpdate = typeof TestGenerationAnnotation.Update;
