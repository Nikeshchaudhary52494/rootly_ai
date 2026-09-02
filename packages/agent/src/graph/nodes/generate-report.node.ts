import { FinalReportDraftSchema } from '../../schemas/investigation.schema';
import { generateValidated, StructuredOutputError } from '../../llm/structured-output';
import type { InvestigationLLM } from '../../llm/llm.client';
import { rootCausePrompt } from '../../prompts/root-cause.prompt';
import type { InvestigationState, InvestigationStateUpdate } from '../investigation.state';

export function createGenerateReportNode(llm: InvestigationLLM) {
  return async function generateReportNode(state: InvestigationState): Promise<InvestigationStateUpdate> {
    const { hypotheses, errorAnalysis, input } = state;
    const topHypothesis = hypotheses[0];
    if (!topHypothesis || !errorAnalysis) {
      return { status: 'FAILED', errors: ['No evaluated hypothesis available to report on.'] };
    }

    try {
      const { system, user } = rootCausePrompt(topHypothesis);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: FinalReportDraftSchema,
        schemaName: 'final_report',
      });

      return {
        status: 'COMPLETED',
        usage: result.usage,
        finalReport: {
          ...result.data,
          // Derived from already-validated state rather than re-asked of the
          // model, so the two highest-stakes facts in the report can't drift.
          confidence: topHypothesis.confidence,
          affectedComponent: input?.latestEvent?.serviceName ?? 'unknown',
          primaryLocation: errorAnalysis.primaryLocation
            ? { file: errorAnalysis.primaryLocation.file, line: errorAnalysis.primaryLocation.line }
            : null,
        },
      };
    } catch (err) {
      const message = err instanceof StructuredOutputError ? err.message : `Report generation failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
