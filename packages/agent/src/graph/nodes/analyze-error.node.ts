import { ErrorAnalysisSchema } from '../../schemas/investigation.schema';
import { generateValidated, StructuredOutputError } from '../../llm/structured-output';
import type { InvestigationLLM } from '../../llm/llm.client';
import { analyzeErrorPrompt } from '../../prompts/analyze-error.prompt';
import type { InvestigationState, InvestigationStateUpdate } from '../investigation.state';

export function createAnalyzeErrorNode(llm: InvestigationLLM) {
  return async function analyzeErrorNode(state: InvestigationState): Promise<InvestigationStateUpdate> {
    const { input } = state;
    if (!input?.latestEvent) {
      return { status: 'FAILED', errors: ['No error event available to analyze.'] };
    }

    try {
      const { system, user } = analyzeErrorPrompt(input.incident, input.latestEvent);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: ErrorAnalysisSchema,
        schemaName: 'error_analysis',
      });

      // The model restates the primary location in prose; trust Phase 4's
      // deterministically-matched location instead of the model's recall of it.
      const groundTruth = input.codeContext?.primaryLocation ?? null;
      const errorAnalysis = {
        ...result.data,
        primaryLocation: groundTruth ? { file: groundTruth.filePath, line: groundTruth.lineNumber ?? 1 } : null,
      };

      return { status: 'ANALYZING_CODE', errorAnalysis, usage: result.usage };
    } catch (err) {
      const message = err instanceof StructuredOutputError ? err.message : `Error analysis failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
