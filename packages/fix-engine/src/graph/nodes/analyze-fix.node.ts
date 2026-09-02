import { generateValidated, StructuredOutputError, type InvestigationLLM } from '@incident-ai/agent';
import { FixAnalysisSchema } from '../../schemas/fix-analysis.schema';
import { analyzeFixPrompt } from '../../prompts/analyze-fix.prompt';
import type { FixGenerationState, FixGenerationStateUpdate } from '../fix-generation.state';

export function createAnalyzeFixNode(llm: InvestigationLLM) {
  return async function analyzeFixNode(state: FixGenerationState): Promise<FixGenerationStateUpdate> {
    const { input } = state;
    if (!input) {
      return { status: 'FAILED', errors: ['No fix-generation input was supplied.'] };
    }

    try {
      const { system, user } = analyzeFixPrompt(input);
      const result = await generateValidated(llm, { system, user, schema: FixAnalysisSchema, schemaName: 'fix_analysis' });
      return { status: 'GENERATING_PATCH', analysis: result.data, usage: result.usage };
    } catch (err) {
      const message =
        err instanceof StructuredOutputError ? err.message : `Fix analysis failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
