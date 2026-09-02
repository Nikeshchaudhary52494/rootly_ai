import { HistoryAnalysisSchema } from '../../schemas/investigation.schema';
import { generateValidated, StructuredOutputError } from '../../llm/structured-output';
import type { InvestigationLLM } from '../../llm/llm.client';
import { analyzeHistoryPrompt } from '../../prompts/analyze-history.prompt';
import type { InvestigationState, InvestigationStateUpdate } from '../investigation.state';
import { getGitHistory } from '../../tools/git-history.tool';

export function createAnalyzeHistoryNode(llm: InvestigationLLM) {
  return async function analyzeHistoryNode(state: InvestigationState): Promise<InvestigationStateUpdate> {
    const { input, codeAnalysis } = state;
    if (!input?.codeContext || !codeAnalysis) {
      return { status: 'FAILED', errors: ['No code analysis available to correlate with history.'] };
    }

    const commits = getGitHistory(input.codeContext);

    // No commit history at all isn't a failure — just nothing to analyze.
    if (commits.length === 0) {
      return { status: 'GENERATING_HYPOTHESES', historyAnalysis: { observations: [] } };
    }

    try {
      const { system, user } = analyzeHistoryPrompt(codeAnalysis, commits);
      const result = await generateValidated(llm, {
        system,
        user,
        schema: HistoryAnalysisSchema,
        schemaName: 'history_analysis',
      });

      // Anti-hallucination gate: only keep observations citing a commit sha we actually supplied.
      const knownShas = new Set(commits.map((c) => c.sha));
      const observations = result.data.observations.filter((obs) => knownShas.has(obs.commitSha));
      const rejected = result.data.observations.length - observations.length;

      return {
        status: 'GENERATING_HYPOTHESES',
        historyAnalysis: { observations },
        usage: result.usage,
        errors: rejected > 0 ? [`Dropped ${rejected} history observation(s) citing an unknown commit sha.`] : [],
      };
    } catch (err) {
      const message = err instanceof StructuredOutputError ? err.message : `History analysis failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'FAILED', errors: [message] };
    }
  };
}
