import { generateValidated, StructuredOutputError, type InvestigationLLM, type LLMUsage } from '@rootly.ai/agent';
import { FixProposalSchema, type FileChange } from '../../schemas/fix-proposal.schema';
import { validatePatchSafety, DEFAULT_PATCH_SAFETY_LIMITS, type PatchSafetyLimits } from '../../patch/patch-validator';
import { generatePatchPrompt } from '../../prompts/generate-patch.prompt';
import type { FixGenerationCodeFile, FixGenerationInput, FixGenerationState, FixGenerationStateUpdate } from '../fix-generation.state';

export class PatchValidationError extends Error {}

function sumUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Early anti-hallucination check against the *cached* context we already
 * showed the model (a code window, not necessarily the whole file). This
 * catches an obviously-invented originalCode before ever paying for a
 * checkout — the authoritative check against the real, freshly-checked-out
 * file happens again in fix-engine.ts before the patch is applied.
 */
function matchesCachedContext(change: FileChange, input: FixGenerationInput): boolean {
  const file = input.codeContext.files.find((f: FixGenerationCodeFile) => f.filePath === change.filePath);
  if (file) {
    if (change.startLine < file.contentStartLine || change.endLine > file.contentEndLine) return false;
    const lines = file.content.split('\n');
    const offset = change.startLine - file.contentStartLine;
    const count = change.endLine - change.startLine + 1;
    return lines.slice(offset, offset + count).join('\n') === change.originalCode;
  }

  const test = input.codeContext.relatedTests.find((t) => t.filePath === change.filePath);
  if (test) {
    const lines = test.content.split('\n');
    if (change.startLine < 1 || change.endLine > lines.length) return false;
    return lines.slice(change.startLine - 1, change.endLine).join('\n') === change.originalCode;
  }

  // A change targeting a file we never showed the model can't be verified here — reject rather than trust it.
  return false;
}

function validateProposal(input: FixGenerationInput, changes: FileChange[], limits: PatchSafetyLimits): string[] {
  const safety = validatePatchSafety(changes, limits);
  const reasons = [...safety.reasons];

  for (const change of changes) {
    if (!matchesCachedContext(change, input)) {
      reasons.push(`${change.filePath}: originalCode does not match the source shown for lines ${change.startLine}-${change.endLine}`);
    }
  }

  return reasons;
}

export function createGeneratePatchNode(llm: InvestigationLLM, limits: PatchSafetyLimits = DEFAULT_PATCH_SAFETY_LIMITS) {
  return async function generatePatchNode(state: FixGenerationState): Promise<FixGenerationStateUpdate> {
    const { input, analysis } = state;
    if (!input || !analysis) {
      return { status: 'FAILED', errors: ['No fix analysis available to generate a patch from.'] };
    }

    try {
      const { system, user } = generatePatchPrompt(input, analysis);

      const first = await generateValidated(llm, { system, user, schema: FixProposalSchema, schemaName: 'fix_proposal' });
      const firstReasons = validateProposal(input, first.data.changes, limits);
      if (firstReasons.length === 0) {
        return { status: 'VALIDATING', proposal: first.data, usage: first.usage };
      }

      const correctionUser = `${user}\n\n---\nYour previous proposal was rejected for: ${firstReasons.join('; ')}\nRegenerate the patch, strictly avoiding these issues — copy originalCode verbatim from the source shown above.`;
      const second = await generateValidated(llm, { system, user: correctionUser, schema: FixProposalSchema, schemaName: 'fix_proposal' });
      const usage = sumUsage(first.usage, second.usage);
      const secondReasons = validateProposal(input, second.data.changes, limits);
      if (secondReasons.length === 0) {
        return { status: 'VALIDATING', proposal: second.data, usage };
      }

      throw new PatchValidationError(`Generated patch failed validation after retry: ${secondReasons.join('; ')}`);
    } catch (err) {
      const message =
        err instanceof StructuredOutputError || err instanceof PatchValidationError
          ? err.message
          : `Patch generation failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
