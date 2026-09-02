import { Octokit } from '@octokit/rest';

export interface GitHubRef {
  ref: string;
  sha: string;
}

export interface GitHubPullRequestInfo {
  number: number;
  url: string;
  htmlUrl: string;
  state: 'open' | 'closed';
  merged: boolean;
}

export type GitHubClientErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'AUTH_FAILED' | 'VALIDATION_FAILED' | 'UNKNOWN';

export class GitHubClientError extends Error {
  constructor(
    public readonly code: GitHubClientErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * All GitHub REST operations this package needs — nothing more. This is a
 * fixed, backend-controlled surface: the set of operations here is exactly
 * what pr-promotion.ts calls, never an AI-chosen endpoint or method.
 */
export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(accessToken: string) {
    this.octokit = new Octokit({ auth: accessToken });
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      return data.default_branch;
    } catch (err) {
      throw sanitize(err, 'Unable to access repository');
    }
  }

  /** Resolves a branch ref to its current commit sha, or null if the branch doesn't exist. */
  async getBranchRef(owner: string, repo: string, branch: string): Promise<GitHubRef | null> {
    try {
      const { data } = await this.octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
      return { ref: data.ref, sha: data.object.sha };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw sanitize(err, `Unable to resolve branch ${branch}`);
    }
  }

  /** Creates a new branch ref pointing at `fromSha`. Never touches an existing ref. */
  async createBranchRef(owner: string, repo: string, branch: string, fromSha: string): Promise<GitHubRef> {
    try {
      const { data } = await this.octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: fromSha });
      return { ref: data.ref, sha: data.object.sha };
    } catch (err) {
      throw sanitize(err, `Unable to create branch ${branch}`);
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string },
  ): Promise<GitHubPullRequestInfo> {
    try {
      const { data } = await this.octokit.pulls.create({
        owner,
        repo,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      });
      return { number: data.number, url: data.url, htmlUrl: data.html_url, state: data.state as 'open' | 'closed', merged: Boolean(data.merged) };
    } catch (err) {
      throw sanitize(err, 'Unable to create pull request');
    }
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequestInfo> {
    try {
      const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
      return { number: data.number, url: data.url, htmlUrl: data.html_url, state: data.state as 'open' | 'closed', merged: Boolean(data.merged) };
    } catch (err) {
      throw sanitize(err, 'Unable to fetch pull request');
    }
  }
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 404);
}

/**
 * Octokit errors carry the request (including the Authorization header) on
 * `.request`/`.response`. Never rethrow the raw error — only its message and
 * a classified code — so a token can never end up in a log line or an API
 * response.
 */
function sanitize(err: unknown, fallback: string): GitHubClientError {
  const status = err && typeof err === 'object' && 'status' in err ? (err as { status: unknown }).status : undefined;
  const message = err instanceof Error ? err.message : fallback;

  if (status === 404) return new GitHubClientError('NOT_FOUND', message || fallback);
  if (status === 409 || status === 422) return new GitHubClientError('CONFLICT', message || fallback);
  if (status === 401) return new GitHubClientError('AUTH_FAILED', message || fallback);
  if (status === 403 && /rate limit/i.test(message)) return new GitHubClientError('RATE_LIMITED', message || fallback);
  if (status === 403) return new GitHubClientError('AUTH_FAILED', message || fallback);
  return new GitHubClientError('UNKNOWN', message || fallback);
}
