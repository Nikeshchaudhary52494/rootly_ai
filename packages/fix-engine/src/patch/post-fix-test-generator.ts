import { generateValidated, StructuredOutputError, type InvestigationLLM, type LLMUsage } from '@incident-ai/agent';
import { validateGeneratedTest } from '@incident-ai/reproduction';
import { PostFixValidationSchema, type PostFixValidation } from '../schemas/post-fix-validation.schema';
import { generatePostFixTestPrompt } from '../prompts/generate-post-fix-test.prompt';
import type { FixGenerationInput } from '../graph/fix-generation.state';
import type { FixProposal } from '../schemas/fix-proposal.schema';

export interface PostFixTestGenerationResult {
  status: 'COMPLETED' | 'FAILED';
  test: PostFixValidation | null;
  usage: LLMUsage;
  errors: string[];
}

function sumUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Generates the test that proves the fix worked. The model proposes content,
 * but it never gets to redefine *what* is being validated: the file path is
 * always forced to the original Phase 6 reproduction test's path (so the
 * same module, at the same location, is what actually gets exercised — a
 * model can't quietly redirect validation at something easier), and the
 * content still passes Phase 6's own safety gate (no network/fs/child_process/
 * process.env, must look like a real Jest test).
 */
export async function generatePostFixValidationTest(
  input: FixGenerationInput,
  proposal: FixProposal,
  options: { llm: InvestigationLLM },
): Promise<PostFixTestGenerationResult> {
  const { system, user } = generatePostFixTestPrompt(input, proposal);
  const forcedFilePath = input.reproduction.testFilePath;

  try {
    const first = await generateValidated(options.llm, {
      system,
      user,
      schema: PostFixValidationSchema,
      schemaName: 'post_fix_validation',
    });
    const firstCandidate = { ...first.data, filePath: forcedFilePath };
    const firstCheck = validateGeneratedTest(firstCandidate);
    if (firstCheck.valid) {
      return { status: 'COMPLETED', test: firstCandidate, usage: first.usage, errors: [] };
    }

    const correctionUser = `${user}\n\n---\nYour previous test was rejected for: ${firstCheck.reasons.join('; ')}\nRegenerate it, strictly avoiding these issues.`;
    const second = await generateValidated(options.llm, {
      system,
      user: correctionUser,
      schema: PostFixValidationSchema,
      schemaName: 'post_fix_validation',
    });
    const usage = sumUsage(first.usage, second.usage);
    const secondCandidate = { ...second.data, filePath: forcedFilePath };
    const secondCheck = validateGeneratedTest(secondCandidate);
    if (secondCheck.valid) {
      return { status: 'COMPLETED', test: secondCandidate, usage, errors: [] };
    }

    return {
      status: 'FAILED',
      test: null,
      usage,
      errors: [`Post-fix validation test failed validation after retry: ${secondCheck.reasons.join('; ')}`],
    };
  } catch (err) {
    const message =
      err instanceof StructuredOutputError ? err.message : `Post-fix test generation failed: ${err instanceof Error ? err.message : String(err)}`;
    return { status: 'FAILED', test: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, errors: [message] };
  }
}
