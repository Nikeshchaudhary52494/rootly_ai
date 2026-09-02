import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderUnifiedDiff } from '@incident-ai/fix-engine';
import { runPrPromotion } from '../src/promotion/pr-promotion';
import type { GitHubClient, GitHubRef, GitHubPullRequestInfo } from '../src/client/github-client';

const execFileAsync = promisify(execFile);

/**
 * pr-promotion.ts talks to two different systems: the GitHub REST API (branch
 * ref lookup/creation, PR creation) and a real git remote (clone/checkout/
 * commit/push). Mocking the REST calls (like every other GitHub test in this
 * project) is easy; a *real* git push needs a real remote to push to. Rather
 * than requiring live GitHub credentials, this uses a local bare git repo as
 * the remote and a FakeGitHubClient whose branch operations manipulate that
 * same bare repo directly — so the git subprocess calls (clone, checkout,
 * commit, push) are all genuinely exercised, while "GitHub" itself is fully
 * under test control and needs no network access.
 */
class FakeGitHubClient {
  public createBranchRefCalls = 0;
  public createPullRequestCalls = 0;

  constructor(private readonly bareRepoPath: string) {}

  async getBranchRef(_owner: string, _repo: string, branch: string): Promise<GitHubRef | null> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', this.bareRepoPath, 'rev-parse', '--verify', `refs/heads/${branch}`]);
      return { ref: `refs/heads/${branch}`, sha: stdout.trim() };
    } catch {
      return null;
    }
  }

  async createBranchRef(_owner: string, _repo: string, branch: string, fromSha: string): Promise<GitHubRef> {
    this.createBranchRefCalls += 1;
    await execFileAsync('git', ['-C', this.bareRepoPath, 'branch', branch, fromSha]);
    return { ref: `refs/heads/${branch}`, sha: fromSha };
  }

  async createPullRequest(): Promise<GitHubPullRequestInfo> {
    this.createPullRequestCalls += 1;
    return { number: 7, url: 'https://api.github.com/repos/acme/repo/pulls/7', htmlUrl: 'https://github.com/acme/repo/pull/7', state: 'open', merged: false };
  }
}

async function git(args: string[], cwd: string) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function makeBareRepoWithCommit(fileContent: string): Promise<{ bareRepoPath: string; commitSha: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'incident-ai-pr-promotion-'));
  const bareRepoPath = join(root, 'origin.git');
  const seedPath = join(root, 'seed');

  await execFileAsync('git', ['init', '--bare', '--quiet', '-b', 'main', bareRepoPath]);
  await execFileAsync('git', ['clone', '--quiet', bareRepoPath, seedPath]);
  await writeFile(join(seedPath, 'math.service.js'), fileContent, 'utf8');
  await git(['add', 'math.service.js'], seedPath);
  await git(['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', 'commit', '--quiet', '-m', 'init'], seedPath);
  await git(['push', '--quiet', 'origin', 'main'], seedPath);
  const commitSha = await git(['rev-parse', 'HEAD'], seedPath);

  return { bareRepoPath, commitSha, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const ORIGINAL = ['function getFirst(list) {', '  return list[0].toUpperCase();', '}', '', 'module.exports = { getFirst };', ''].join('\n');
const PATCHED = ['function getFirst(list) {', "  return (list[0] ?? '').toUpperCase();", '}', '', 'module.exports = { getFirst };', ''].join('\n');

function baseInput(overrides: Partial<Parameters<typeof runPrPromotion>[0]> = {}) {
  return {
    owner: 'acme',
    repo: 'repo',
    repositoryUrl: '', // filled in per test
    // Exercises the `-c http.extraHeader=...` push path (git ignores it for a local
    // file-path remote, but this catches argument-ordering bugs in the push command itself —
    // see the regression this caught: `git push -c ...` is invalid, only `git -c ... push` is).
    accessToken: 'fake-test-token',
    defaultBranch: 'main',
    targetCommitSha: '', // filled in per test
    branchName: 'incident/42/fix-handle-empty-list',
    patches: [
      {
        filePath: 'math.service.js',
        originalContent: ORIGINAL,
        patchedContent: PATCHED,
        diff: renderUnifiedDiff('math.service.js', ORIGINAL, PATCHED),
      },
    ],
    commitMessage: 'fix(incident-42): handle empty list\n\nIncident: #42',
    prTitle: 'fix: handle empty list',
    prBody: '## Incident\n\nIncident #42\n',
    ...overrides,
  };
}

test('runPrPromotion: creates a branch, commits the exact verified patch, pushes it, and opens a PR', { timeout: 30000 }, async () => {
  const repo = await makeBareRepoWithCommit(ORIGINAL);
  try {
    const client = new FakeGitHubClient(repo.bareRepoPath);
    const result = await runPrPromotion(baseInput({ repositoryUrl: repo.bareRepoPath, targetCommitSha: repo.commitSha }), {
      client: client as unknown as GitHubClient,
    });

    assert.equal(result.status, 'CREATED');
    assert.equal(result.branchName, 'incident/42/fix-handle-empty-list');
    assert.equal(result.prNumber, 7);
    assert.equal(result.prUrl, 'https://github.com/acme/repo/pull/7');
    assert.ok(result.commitSha && result.commitSha !== repo.commitSha);

    const branchContent = await git(['show', `${result.branchName}:math.service.js`], repo.bareRepoPath);
    assert.equal(branchContent, PATCHED.trimEnd());

    // The default branch itself must be completely untouched by promotion.
    const mainSha = await git(['rev-parse', 'main'], repo.bareRepoPath);
    assert.equal(mainSha, repo.commitSha);

    assert.equal(client.createPullRequestCalls, 1);
  } finally {
    await repo.cleanup();
  }
});

test('runPrPromotion: rejects promotion when a forbidden file is in the patch set, before ever touching GitHub', async () => {
  const repo = await makeBareRepoWithCommit(ORIGINAL);
  try {
    const client = new FakeGitHubClient(repo.bareRepoPath);
    const result = await runPrPromotion(
      baseInput({
        repositoryUrl: repo.bareRepoPath,
        targetCommitSha: repo.commitSha,
        patches: [{ filePath: '.env', originalContent: 'X=1', patchedContent: 'X=2', diff: renderUnifiedDiff('.env', 'X=1', 'X=2') }],
      }),
      { client: client as unknown as GitHubClient },
    );

    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'PROMOTION_VALIDATION_FAILED');
    assert.equal(client.createBranchRefCalls, 0);
    assert.equal(client.createPullRequestCalls, 0);
  } finally {
    await repo.cleanup();
  }
});

test('runPrPromotion: aborts if the real file content has drifted since Phase 7 validation', async () => {
  // The bare repo's real content differs from what the FixPatch record claims was "original" —
  // simulating the file changing on the base branch between validation and promotion.
  const repo = await makeBareRepoWithCommit('function getFirst(list) { return "drifted"; }\n');
  try {
    const client = new FakeGitHubClient(repo.bareRepoPath);
    const result = await runPrPromotion(baseInput({ repositoryUrl: repo.bareRepoPath, targetCommitSha: repo.commitSha }), {
      client: client as unknown as GitHubClient,
    });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'PATCH_APPLICATION_FAILED');
    assert.equal(client.createPullRequestCalls, 0);

    // No leftover checkout directories.
  } finally {
    await repo.cleanup();
  }
});

test('runPrPromotion: a branch name that already exists fails as BRANCH_CREATION_FAILED (dedup is the caller\'s job, not this function\'s)', async () => {
  const repo = await makeBareRepoWithCommit(ORIGINAL);
  try {
    const client = new FakeGitHubClient(repo.bareRepoPath);
    // Simulate the caller having already resolved (and reserved) this exact name elsewhere.
    await client.createBranchRef('acme', 'repo', 'incident/42/fix-handle-empty-list', repo.commitSha);

    const result = await runPrPromotion(baseInput({ repositoryUrl: repo.bareRepoPath, targetCommitSha: repo.commitSha }), {
      client: client as unknown as GitHubClient,
    });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'BRANCH_CREATION_FAILED');
  } finally {
    await repo.cleanup();
  }
});

test('runPrPromotion: refuses to push if the branch name equals the default branch', async () => {
  const repo = await makeBareRepoWithCommit(ORIGINAL);
  try {
    const client = new FakeGitHubClient(repo.bareRepoPath);
    const result = await runPrPromotion(
      baseInput({ repositoryUrl: repo.bareRepoPath, targetCommitSha: repo.commitSha, branchName: 'main', defaultBranch: 'main' }),
      { client: client as unknown as GitHubClient },
    );

    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'BRANCH_CREATION_FAILED');
    assert.equal(client.createPullRequestCalls, 0);

    // The default branch itself must be provably untouched.
    const mainSha = await git(['rev-parse', 'main'], repo.bareRepoPath);
    assert.equal(mainSha, repo.commitSha);
  } finally {
    await repo.cleanup();
  }
});
