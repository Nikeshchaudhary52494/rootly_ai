export interface CommitMessageInput {
  incidentSequenceNumber: number;
  errorName: string;
  fixSummary: string | null;
}

export interface CommitMessage {
  title: string;
  body: string;
  /** `title\n\n${body}`, ready to pass to `git commit -m`. */
  full: string;
}

const MAX_TITLE_LENGTH = 72;

/**
 * Entirely backend-constructed — never an AI-generated shell command or
 * commit message string. The only AI-derived input is `fixSummary` (a
 * sentence, already stored on FixAttempt), used purely as message text.
 */
export function generateCommitMessage(input: CommitMessageInput): CommitMessage {
  const subject = input.fixSummary?.trim() || `fix ${input.errorName}`;
  const title = truncate(`fix(incident-${input.incidentSequenceNumber}): ${subject}`, MAX_TITLE_LENGTH);

  const bodyLines = [`Incident: #${input.incidentSequenceNumber}`, '', 'Generated and validated by rootly.ai.'];
  const body = bodyLines.join('\n');

  return { title, body, full: `${title}\n\n${body}` };
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
