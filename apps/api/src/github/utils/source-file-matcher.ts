/**
 * Matches a (possibly prefixed) stack trace file path against the set of paths
 * in a synced repository tree. Tries the full path first, then progressively
 * shorter path suffixes; the first suffix length with exactly one match wins.
 * A suffix length with more than one match is ambiguous and is not resolved
 * further — an ambiguous match never falls back to a shorter, even-more-ambiguous one.
 */
export function matchSourceFile(stackFilePath: string, repositoryPaths: string[]): string | null {
  const normalized = stackFilePath.replace(/^\/+/, '');
  if (!normalized) return null;

  const segments = normalized.split('/');

  for (let i = 0; i < segments.length; i += 1) {
    const suffix = segments.slice(i).join('/');
    const matches = repositoryPaths.filter((path) => path === suffix || path.endsWith(`/${suffix}`));

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null; // ambiguous — don't guess
  }

  return null;
}
