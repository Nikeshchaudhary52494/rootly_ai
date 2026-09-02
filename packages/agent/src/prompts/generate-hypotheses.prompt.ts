import { systemPrompt } from './shared';
import type { ErrorAnalysis, CodeAnalysis, HistoryAnalysis } from '../schemas/investigation.schema';

export function generateHypothesesPrompt(
  errorAnalysis: ErrorAnalysis,
  codeAnalysis: CodeAnalysis,
  historyAnalysis: HistoryAnalysis,
) {
  const system = systemPrompt(
    'You are a senior software engineer forming root-cause hypotheses for a production incident, based only ' +
      'on the analysis already performed. Propose 1 to 3 hypotheses, ranked by how well the evidence so far ' +
      'supports each one. Do not assign very high confidence (above 0.9) unless the evidence is unambiguous.',
  );

  const user = [
    'Error analysis:',
    JSON.stringify(errorAnalysis, null, 2),
    '',
    'Code analysis:',
    JSON.stringify(codeAnalysis, null, 2),
    '',
    'History analysis:',
    JSON.stringify(historyAnalysis, null, 2),
    '',
    'Propose 1 to 3 distinct, plausible root-cause hypotheses for this incident. Each needs a short title, a ' +
      'one-to-two sentence description, and an initial confidence between 0 and 1 based on how strongly the ' +
      'analysis above supports it.',
  ].join('\n');

  return { system, user };
}
