import { generateValidated, StructuredOutputError, type InvestigationLLM, type LLMUsage } from '@rootly.ai/agent';
import { ReproductionTestSchema, type ReproductionTest } from '../../schemas/reproduction.schema';
import { validateGeneratedTest } from '../../test/test-validator';
import { generateTestPrompt } from '../../prompts/generate-test.prompt';
import type { TestGenerationState, TestGenerationStateUpdate } from '../generation.state';

export class TestValidationError extends Error {}

function sumUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export function createGenerateTestNode(llm: InvestigationLLM) {
  return async function generateTestNode(state: TestGenerationState): Promise<TestGenerationStateUpdate> {
    const { input, understanding } = state;
    if (!input || !understanding) {
      return { status: 'FAILED', errors: ['No failure understanding available to generate a test from.'] };
    }

    try {
      const { system, user } = generateTestPrompt(input, understanding);

      const first = await generateValidated(llm, {
        system,
        user,
        schema: ReproductionTestSchema,
        schemaName: 'reproduction_test',
      });
      const firstCheck = validateGeneratedTest(first.data);
      if (firstCheck.valid) {
        return { status: 'VALIDATING_TEST', test: first.data, usage: first.usage };
      }

      // The generated test violated a safety/path rule (not a schema shape issue) — retry once with
      // the specific reasons so the model can self-correct, exactly as with a schema failure.
      const correctionUser = `${user}\n\n---\nYour previous test was rejected for: ${firstCheck.reasons.join('; ')}\nRegenerate the test, strictly avoiding these issues.`;
      const second = await generateValidated(llm, {
        system,
        user: correctionUser,
        schema: ReproductionTestSchema,
        schemaName: 'reproduction_test',
      });
      const usage = sumUsage(first.usage, second.usage);
      const secondCheck = validateGeneratedTest(second.data);
      if (secondCheck.valid) {
        return { status: 'VALIDATING_TEST', test: second.data, usage };
      }

      throw new TestValidationError(`Generated test failed validation after retry: ${secondCheck.reasons.join('; ')}`);
    } catch (err) {
      const message =
        err instanceof StructuredOutputError || err instanceof TestValidationError
          ? err.message
          : `Test generation failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}

export type { ReproductionTest };
