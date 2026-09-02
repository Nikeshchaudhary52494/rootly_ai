import { systemPrompt } from './shared';
import type { InvestigationHypothesisResult } from '../graph/investigation.state';

export function rootCausePrompt(topHypothesis: InvestigationHypothesisResult) {
  const system = systemPrompt(
    'You are writing the final root-cause report for a production incident, based on the single ' +
      'best-supported hypothesis below. Write a concise, factual report. The recommendation must be ' +
      'descriptive guidance only — never write or suggest actual code, and never mention creating branches, ' +
      'commits, or pull requests; that is out of scope for this report.',
  );

  const user = [
    `Hypothesis: ${topHypothesis.title}`,
    `Description: ${topHypothesis.description}`,
    `Confidence: ${topHypothesis.confidence}`,
    `Status: ${topHypothesis.status}`,
    '',
    'Supporting evidence:',
    topHypothesis.supportingEvidence.map((e) => `- ${e.description} (${e.sourceReference})`).join('\n') || '(none)',
    '',
    'Contradicting evidence:',
    topHypothesis.contradictingEvidence.map((e) => `- ${e.description} (${e.sourceReference})`).join('\n') || '(none)',
    '',
    'Write: a one-sentence summary, a short root-cause explanation, the production impact, and a descriptive ' +
      '(non-code) recommendation for how an engineer should address it.',
  ].join('\n');

  return { system, user };
}
