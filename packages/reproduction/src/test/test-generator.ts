import type { InvestigationLLM, LLMUsage } from '@incident-ai/agent';
import { buildTestGenerationGraph } from '../graph/generation.graph';
import type { TestGenerationInput } from '../graph/generation.state';
import type { ReproductionTest } from '../schemas/reproduction.schema';

export interface TestGenerationResult {
  status: 'COMPLETED' | 'FAILED';
  test: ReproductionTest | null;
  usage: LLMUsage;
  errors: string[];
}

/**
 * Runs the LOAD -> UNDERSTAND_FAILURE -> GENERATE_TEST -> VALIDATE_TEST graph
 * and returns a plain result. Never throws — an unexpected exception is
 * reported as a FAILED result so a caller is never left without a status.
 */
export async function generateReproductionTest(
  input: TestGenerationInput,
  options: { llm: InvestigationLLM },
): Promise<TestGenerationResult> {
  const graph = buildTestGenerationGraph(options.llm);

  try {
    const finalState = await graph.invoke({ input, status: 'RUNNING' });
    const status = finalState.status === 'VALIDATING_TEST' && finalState.test ? 'COMPLETED' : 'FAILED';

    return {
      status,
      test: finalState.test,
      usage: finalState.usage,
      errors: status === 'FAILED' && finalState.errors.length === 0 ? ['Test generation did not produce a test.'] : finalState.errors,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      test: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      errors: [err instanceof Error ? err.message : 'Unexpected test generation failure'],
    };
  }
}
