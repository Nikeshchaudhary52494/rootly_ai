import { CodeAnalysisSchema } from '../../schemas/investigation.schema';
import { generateValidated, StructuredOutputError } from '../../llm/structured-output';
import type { InvestigationLLM } from '../../llm/llm.client';
import { analyzeCodePrompt } from '../../prompts/analyze-code.prompt';
import type { InvestigationState, InvestigationStateUpdate } from '../investigation.state';
import { buildKnownFileRanges, isLineWithinKnownFile } from './context-line-ranges';

export function createAnalyzeCodeNode(llm: InvestigationLLM) {
  return async function analyzeCodeNode(state: InvestigationState): Promise<InvestigationStateUpdate> {
    const { input, errorAnalysis } = state;
    if (!input?.codeContext || !errorAnalysis) {
      return { status: 'FAILED', errors: ['No code context available to analyze.'] };
    }

    try {
      const { system, user } = analyzeCodePrompt(errorAnalysis, input.codeContext.files, input.codeContext.relatedTests);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: CodeAnalysisSchema,
        schemaName: 'code_analysis',
      });

      // Anti-hallucination gate: drop any observation whose file/line wasn't
      // literally part of what we showed the model — never store it as fact.
      const knownRanges = buildKnownFileRanges(input.codeContext);
      const observations = result.data.observations.filter(
        (obs) =>
          isLineWithinKnownFile(knownRanges, obs.sourceFile, obs.lineStart) &&
          isLineWithinKnownFile(knownRanges, obs.sourceFile, obs.lineEnd),
      );
      const rejected = result.data.observations.length - observations.length;

      return {
        status: 'ANALYZING_HISTORY',
        codeAnalysis: { observations },
        usage: result.usage,
        errors: rejected > 0 ? [`Dropped ${rejected} code observation(s) referencing a file/line not in context.`] : [],
      };
    } catch (err) {
      const message = err instanceof StructuredOutputError ? err.message : `Code analysis failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
