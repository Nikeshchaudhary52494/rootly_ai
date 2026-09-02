import { systemPrompt } from './shared';
import type { CodeAnalysis } from '../schemas/investigation.schema';
import type { InvestigationCommit } from '../graph/investigation.state';

export function analyzeHistoryPrompt(codeAnalysis: CodeAnalysis, commits: InvestigationCommit[]) {
  const system = systemPrompt(
    'You are a senior software engineer reviewing recent git history for clues about a production incident. ' +
      'Treat history as evidence, not proof — do not assume the most recent commit caused the bug just ' +
      'because it is most recent.',
  );

  const commitList = commits.length
    ? commits
        .map((c) => `- ${c.sha}  ${c.committedAt}  ${c.authorName}\n  "${c.message.split('\n')[0]}"`)
        .join('\n')
    : '(no commit history is available for the relevant file)';

  const user = [
    'Code observations so far:',
    JSON.stringify(codeAnalysis, null, 2),
    '',
    'Recent commits touching the relevant file (most recent first):',
    commitList,
    '',
    'For any commit that plausibly relates to this incident, note its exact sha (copied from above), a short ' +
      'description of why it might be relevant, and a relevance score from 0 to 1. Only reference commit shas ' +
      'that appear in the list above. If none seem relevant, return an empty list.',
  ].join('\n');

  return { system, user };
}
