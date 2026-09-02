export interface PullRequestContentInput {
  incidentSequenceNumber: number;
  errorName: string;
  errorMessage: string;
  rootCause: string | null;
  targetCommitSha: string;
  fixExplanation: string | null;
  changedFiles: string[];
  regressionTestsRan: boolean;
}

export interface PullRequestContent {
  title: string;
  body: string;
}

const MAX_TITLE_LENGTH = 100;

/**
 * Entirely backend-templated from data already produced by earlier phases
 * (investigation root cause, fix explanation, changed files) — no new LLM
 * call, and never AI-chosen markup or endpoints. Kept deliberately short:
 * no stdout/stderr, no full diffs — those already live on the FixAttempt
 * record for anyone who wants them.
 */
export function generatePullRequestContent(input: PullRequestContentInput): PullRequestContent {
  const subject = input.fixExplanation?.trim().replace(/\.$/, '') || `handle ${input.errorName}`;
  const title = truncate(`fix: ${subject}`, MAX_TITLE_LENGTH);

  const changedFilesList = input.changedFiles.length ? input.changedFiles.map((f) => `- ${f}`).join('\n') : '- (none recorded)';

  const body = [
    '## Incident',
    '',
    `Incident #${input.incidentSequenceNumber}`,
    '',
    '## Error',
    '',
    `${input.errorName}: ${input.errorMessage}`,
    '',
    '## Root Cause',
    '',
    input.rootCause?.trim() || '_No investigation summary recorded._',
    '',
    '## Reproduction',
    '',
    '✓ Bug reproduced in an isolated Docker sandbox',
    '',
    `Target commit: \`${input.targetCommitSha}\``,
    '',
    '## Fix',
    '',
    input.fixExplanation?.trim() || '_No fix explanation recorded._',
    '',
    '## Validation',
    '',
    '✓ Reproduction test passed after fix',
    input.regressionTestsRan ? '✓ Regression tests passed' : '_No related regression tests were found._',
    '',
    '## Changed Files',
    '',
    changedFilesList,
    '',
    '## rootly.ai',
    '',
    'Generated and validated by rootly.ai. A human reviewer must approve and merge this pull request.',
  ].join('\n');

  return { title, body };
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
