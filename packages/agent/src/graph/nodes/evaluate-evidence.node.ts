import { EvidenceEvaluationSchema } from '../../schemas/investigation.schema';
import type { EvidenceCandidate, ResolvedEvidence } from '../../schemas/investigation.schema';
import { generateValidated, StructuredOutputError } from '../../llm/structured-output';
import type { InvestigationLLM } from '../../llm/llm.client';
import { evaluateEvidencePrompt } from '../../prompts/evaluate-evidence.prompt';
import type { InvestigationState, InvestigationStateUpdate, InvestigationHypothesisResult } from '../investigation.state';

function resolveEvidence(
  ids: string[],
  pool: EvidenceCandidate[],
  type: 'SUPPORTING' | 'CONTRADICTING',
  confidence: number,
): ResolvedEvidence[] {
  const byId = new Map(pool.map((e) => [e.id, e]));
  return ids
    .map((id) => byId.get(id))
    .filter((e): e is EvidenceCandidate => Boolean(e)) // reject any id not in the validated pool
    .map((e) => ({
      type,
      description: e.description,
      sourceType: e.type,
      sourceReference: e.sourceReference,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      confidence,
    }));
}

export function createEvaluateEvidenceNode(llm: InvestigationLLM) {
  return async function evaluateEvidenceNode(state: InvestigationState): Promise<InvestigationStateUpdate> {
    const { hypotheses, evidencePool } = state;
    if (hypotheses.length === 0) {
      return { status: 'FAILED', errors: ['No hypotheses to evaluate.'] };
    }

    try {
      const { system, user } = evaluateEvidencePrompt(hypotheses, evidencePool);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: EvidenceEvaluationSchema,
        schemaName: 'evidence_evaluation',
      });

      const byIndex = new Map(result.data.evaluations.map((e) => [e.hypothesisIndex, e]));
      let rejectedEvidenceIds = 0;

      const evaluated: InvestigationHypothesisResult[] = hypotheses.map((draft, i) => {
        const evaluation = byIndex.get(i);
        if (!evaluation) {
          return { ...draft, supportingEvidence: [], contradictingEvidence: [] };
        }

        const supporting = resolveEvidence(evaluation.supportingEvidenceIds, evidencePool, 'SUPPORTING', evaluation.revisedConfidence);
        const contradicting = resolveEvidence(evaluation.contradictingEvidenceIds, evidencePool, 'CONTRADICTING', evaluation.revisedConfidence);
        rejectedEvidenceIds +=
          evaluation.supportingEvidenceIds.length -
          supporting.length +
          (evaluation.contradictingEvidenceIds.length - contradicting.length);

        return {
          title: draft.title,
          description: draft.description,
          confidence: evaluation.revisedConfidence,
          status: evaluation.status,
          rank: 0, // assigned below once sorted
          supportingEvidence: supporting,
          contradictingEvidence: contradicting,
        };
      });

      evaluated.sort((a, b) => b.confidence - a.confidence);
      evaluated.forEach((h, i) => {
        h.rank = i + 1;
      });

      return {
        status: 'GENERATING_REPORT',
        hypotheses: evaluated,
        usage: result.usage,
        errors: rejectedEvidenceIds > 0 ? [`Dropped ${rejectedEvidenceIds} evidence citation(s) referencing an unknown evidence id.`] : [],
      };
    } catch (err) {
      const message = err instanceof StructuredOutputError ? err.message : `Evidence evaluation failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
