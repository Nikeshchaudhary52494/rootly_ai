import type { InvestigationCodeContext, InvestigationCommit } from '../graph/investigation.state';

/** Read-only: recent commits already collected for this incident's primary file. No live GitHub calls. */
export function getGitHistory(codeContext: InvestigationCodeContext): InvestigationCommit[] {
  return codeContext.recentCommits;
}
