import { generateValidated, StructuredOutputError, type InvestigationLLM } from '@rootly.ai/agent';
import { FailureUnderstandingSchema } from '../../schemas/failure-understanding.schema';
import { understandFailurePrompt } from '../../prompts/understand-failure.prompt';
import type { TestGenerationState, TestGenerationStateUpdate } from '../generation.state';

export function createUnderstandFailureNode(llm: InvestigationLLM) {
  return async function understandFailureNode(state: TestGenerationState): Promise<TestGenerationStateUpdate> {
    const { input } = state;
    if (!input) {
      return { status: 'FAILED', errors: ['No test-generation input was supplied.'] };
    }

    try {
      const { system, user } = understandFailurePrompt(input);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: FailureUnderstandingSchema,
        schemaName: 'failure_understanding',
      });

      return { status: 'GENERATING_TEST', understanding: result.data, usage: result.usage };
    } catch (err) {
      const message =
        err instanceof StructuredOutputError ? err.message : `Failure understanding failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
