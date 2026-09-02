import { systemPrompt } from './shared';
import type { EvidenceCandidate, HypothesisDraft } from '../schemas/investigation.schema';

export function evaluateEvidencePrompt(hypotheses: HypothesisDraft[], evidencePool: EvidenceCandidate[]) {
  const system = systemPrompt(
    'You are a senior software engineer weighing evidence for and against candidate root-cause hypotheses. ' +
      'You may only cite evidence ids from the pool below — never invent a new id, file, or commit. ' +
      'Confidence must reflect the balance of supporting versus contradicting evidence: strong, unambiguous, ' +
      'uncontradicted support warrants 0.90+, moderate support 0.50-0.74, weak or thin support below 0.5.',
  );

  const hypothesisList = hypotheses
    .map((h, i) => `${i}. "${h.title}" — ${h.description} (initial confidence ${h.confidence})`)
    .join('\n');

  const evidenceList = evidencePool.length
    ? evidencePool
        .map((e) => `- id=${e.id} [${e.type}] ${e.description} (${e.sourceReference}${e.lineStart ? `:${e.lineStart}` : ''})`)
        .join('\n')
    : '(no evidence pool was built — every hypothesis should be treated as unsupported)';

  const user = [
    'Candidate hypotheses (by index):',
    hypothesisList,
    '',
    'Evidence pool (only these ids may be cited):',
    evidenceList,
    '',
    'For every hypothesis index above, list which evidence ids support it, which contradict it, note up to 5 ' +
      'short descriptions of what evidence would be needed but is missing, assign a revised confidence, and ' +
      'classify the hypothesis as LIKELY, POSSIBLE, or REJECTED.',
  ].join('\n');

  return { system, user };
}
