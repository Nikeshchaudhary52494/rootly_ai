import { HypothesesSchema } from '../../schemas/investigation.schema';
import { generateValidated, StructuredOutputError } from '../../llm/structured-output';
import type { InvestigationLLM } from '../../llm/llm.client';
import { generateHypothesesPrompt } from '../../prompts/generate-hypotheses.prompt';
import type { InvestigationState, InvestigationStateUpdate } from '../investigation.state';
import { buildEvidencePool } from '../evidence-pool';

export function createGenerateHypothesesNode(llm: InvestigationLLM) {
  return async function generateHypothesesNode(state: InvestigationState): Promise<InvestigationStateUpdate> {
    const { errorAnalysis, codeAnalysis, historyAnalysis } = state;
    if (!errorAnalysis || !codeAnalysis || !historyAnalysis) {
      return { status: 'FAILED', errors: ['Missing prior analysis needed to generate hypotheses.'] };
    }

    const evidencePool = buildEvidencePool(errorAnalysis, codeAnalysis, historyAnalysis);

    try {
      const { system, user } = generateHypothesesPrompt(errorAnalysis, codeAnalysis, historyAnalysis);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: HypothesesSchema,
        schemaName: 'hypotheses',
      });

      return {
        status: 'EVALUATING_EVIDENCE',
        evidencePool,
        // Hypothesis drafts are staged on `hypotheses` in draft form; evaluate-evidence
        // fills in evidence/status/rank and this array is replaced wholesale there.
        hypotheses: result.data.hypotheses.map((h, i) => ({
          title: h.title,
          description: h.description,
          confidence: h.confidence,
          status: 'POSSIBLE' as const,
          rank: i + 1,
          supportingEvidence: [],
          contradictingEvidence: [],
        })),
        usage: result.usage,
      };
    } catch (err) {
      const message = err instanceof StructuredOutputError ? err.message : `Hypothesis generation failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
