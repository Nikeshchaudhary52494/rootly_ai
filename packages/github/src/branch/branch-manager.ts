import type { GitHubClient } from '../client/github-client';

const MAX_SLUG_LENGTH = 40;
const MAX_SUFFIX_ATTEMPTS = 50;

/** Lowercase, ascii-safe, no path traversal, no leading/trailing/duplicate dashes. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (slug || 'fix').slice(0, MAX_SLUG_LENGTH).replace(/-$/, '');
}

/**
 * Deterministic branch name from data the backend already has — never an
 * AI-chosen string. `seedText` is typically the fix explanation or the
 * incident's error name; sequenceNumber ties the branch back to the
 * incident it fixes (e.g. "incident/42/fix-null-customer").
 */
export function generateBranchName(sequenceNumber: number, seedText: string): string {
  return `incident/${sequenceNumber}/fix-${slugify(seedText)}`;
}

/**
 * Appends "-2", "-3", ... until a name that doesn't already exist as a real
 * branch on GitHub is found. Bounded so a persistently failing GitHub call
 * can never spin forever.
 */
export async function resolveUniqueBranchName(
  client: GitHubClient,
  owner: string,
  repo: string,
  candidate: string,
): Promise<string> {
  for (let suffix = 1; suffix <= MAX_SUFFIX_ATTEMPTS; suffix++) {
    const name = suffix === 1 ? candidate : `${candidate}-${suffix}`;
    const existing = await client.getBranchRef(owner, repo, name);
    if (!existing) return name;
  }
  throw new Error(`Could not find a unique branch name after ${MAX_SUFFIX_ATTEMPTS} attempts (base: ${candidate})`);
}
