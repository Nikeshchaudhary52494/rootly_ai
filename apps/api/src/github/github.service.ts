import { Octokit } from '@octokit/rest';
import type { GitHubCommitSummary, GitHubRepositoryMetadata, GitHubTreeEntry } from './types/github.types';

const DEFAULT_COMMIT_LIMIT = 10;

function client(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}

/**
 * Octokit errors carry the request (including the Authorization header) on
 * `.request`/`.response`. Never rethrow the raw error — only its message —
 * so a token can never end up in a log line or an API response.
 */
function sanitizeError(err: unknown, fallback: string): Error {
  const message = err instanceof Error ? err.message : fallback;
  return new Error(message || fallback);
}

export async function getRepository(
  accessToken: string,
  owner: string,
  name: string,
): Promise<GitHubRepositoryMetadata> {
  try {
    const { data } = await client(accessToken).repos.get({ owner, repo: name });
    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.default_branch,
      private: data.private,
    };
  } catch (err) {
    throw sanitizeError(err, 'Unable to access repository');
  }
}

export async function getDefaultBranch(accessToken: string, owner: string, name: string): Promise<string> {
  return (await getRepository(accessToken, owner, name)).defaultBranch;
}

export async function getDirectoryTree(
  accessToken: string,
  owner: string,
  name: string,
  branch: string,
): Promise<GitHubTreeEntry[]> {
  const octokit = client(accessToken);
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo: name, ref: `heads/${branch}` });
    const { data: commit } = await octokit.git.getCommit({ owner, repo: name, commit_sha: ref.object.sha });
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo: name,
      tree_sha: commit.tree.sha,
      recursive: 'true',
    });

    return (tree.tree ?? [])
      .filter((entry): entry is typeof entry & { path: string; sha: string } => Boolean(entry.path && entry.sha))
      .map((entry) => ({
        path: entry.path,
        type: entry.type === 'tree' ? 'DIRECTORY' : 'FILE',
        sha: entry.sha,
      }));
  } catch (err) {
    throw sanitizeError(err, 'Unable to fetch repository tree');
  }
}

export async function getFileContent(
  accessToken: string,
  owner: string,
  name: string,
  path: string,
  ref: string,
): Promise<string> {
  try {
    const { data } = await client(accessToken).repos.getContent({ owner, repo: name, path, ref });
    if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
      throw new Error(`${path} is not a readable file`);
    }
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    throw sanitizeError(err, `Unable to fetch ${path}`);
  }
}

export async function getCommitsForFile(
  accessToken: string,
  owner: string,
  name: string,
  path: string,
  ref: string,
  limit = DEFAULT_COMMIT_LIMIT,
): Promise<GitHubCommitSummary[]> {
  try {
    const { data } = await client(accessToken).repos.listCommits({
      owner,
      repo: name,
      path,
      sha: ref,
      per_page: limit,
    });

    return data.map((entry) => ({
      sha: entry.sha,
      message: entry.commit.message,
      authorName: entry.commit.author?.name ?? entry.author?.login ?? 'unknown',
      authorEmail: entry.commit.author?.email ?? '',
      committedAt: entry.commit.author?.date ?? new Date().toISOString(),
    }));
  } catch (err) {
    throw sanitizeError(err, `Unable to fetch commits for ${path}`);
  }
}
