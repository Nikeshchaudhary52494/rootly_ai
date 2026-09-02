export interface TargetCommitInput {
  /** A commit sha explicitly recorded against the incident's code context, if one exists. */
  codeContextCommitSha?: string | null;
  /** IncidentCodeCommit rows for the primary file, most-recent first. */
  recentCommits: Array<{ sha: string }>;
  /** The repository's default branch name, used as a last-resort ref (not a resolved sha). */
  defaultBranch?: string | null;
}

/**
 * Priority: an incident-pinned commit, then the most recent commit known to
 * touch the affected file, then the default branch as a ref (git resolves it
 * to a concrete sha at checkout time — see repository-checkout.ts).
 * Never silently falls through to "whatever HEAD happens to be" without one
 * of these being the deliberate reason.
 */
export function determineTargetCommit(input: TargetCommitInput): string | null {
  if (input.codeContextCommitSha) return input.codeContextCommitSha;
  if (input.recentCommits.length > 0) return input.recentCommits[0].sha;
  if (input.defaultBranch) return input.defaultBranch;
  return null;
}
