export interface ParsedRepository {
  owner: string;
  name: string;
}

const URL_PATTERNS = [
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
];

/**
 * Normalizes the supported GitHub URL forms (https, https+.git, ssh) into { owner, name }.
 */
export function parseGithubRepositoryUrl(url: string): ParsedRepository {
  const trimmed = url.trim();

  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return { owner: match[1], name: match[2] };
  }

  throw new Error('repositoryUrl must be a valid GitHub repository URL');
}
