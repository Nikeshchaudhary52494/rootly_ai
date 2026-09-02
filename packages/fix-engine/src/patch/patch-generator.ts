import type { InvestigationLLM, LLMUsage } from '@rootly.ai/agent';
import { buildFixGenerationGraph } from '../graph/fix-generation.graph';
import type { FixGenerationInput } from '../graph/fix-generation.state';
import type { FixProposal } from '../schemas/fix-proposal.schema';
import type { PatchSafetyLimits } from './patch-validator';
import { DEFAULT_PATCH_SAFETY_LIMITS } from './patch-validator';

export interface PatchGenerationResult {
  status: 'COMPLETED' | 'FAILED';
  proposal: FixProposal | null;
  usage: LLMUsage;
  errors: string[];
}

/**
 * Runs ANALYZE_FIX -> GENERATE_PATCH and returns a plain result. Never
 * throws — an unexpected exception is reported as FAILED so a caller is
 * never left without a status.
 */
export async function generateFixProposal(
  input: FixGenerationInput,
  options: { llm: InvestigationLLM; limits?: PatchSafetyLimits },
): Promise<PatchGenerationResult> {
  const graph = buildFixGenerationGraph(options.llm, options.limits ?? DEFAULT_PATCH_SAFETY_LIMITS);

  try {
    const finalState = await graph.invoke({ input, status: 'RUNNING' });
    const status = finalState.status === 'VALIDATING' && finalState.proposal ? 'COMPLETED' : 'FAILED';

    return {
      status,
      proposal: finalState.proposal,
      usage: finalState.usage,
      errors: status === 'FAILED' && finalState.errors.length === 0 ? ['Patch generation did not produce a proposal.'] : finalState.errors,
    };
  } catch (err) {
    return {
      status: 'FAILED',
      proposal: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      errors: [err instanceof Error ? err.message : 'Unexpected patch generation failure'],
    };
  }
}
