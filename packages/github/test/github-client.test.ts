import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { GitHubClient, GitHubClientError } from '../src/client/github-client';

const GITHUB_API = 'https://api.github.com';
const TOKEN = 'test-token-should-never-leak';

before(() => {
  nock.disableNetConnect();
});

after(() => {
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

test('getDefaultBranch: returns the repository default branch', async () => {
  nock(GITHUB_API).get('/repos/owner/repo').reply(200, { default_branch: 'main' });
  const client = new GitHubClient(TOKEN);
  assert.equal(await client.getDefaultBranch('owner', 'repo'), 'main');
});

test('getBranchRef: returns null for a branch that does not exist (404)', async () => {
  nock(GITHUB_API).get('/repos/owner/repo/git/ref/heads%2Fincident%2F42%2Ffix-x').reply(404, { message: 'Not Found' });
  const client = new GitHubClient(TOKEN);
  assert.equal(await client.getBranchRef('owner', 'repo', 'incident/42/fix-x'), null);
});

test('getBranchRef: returns the sha for a branch that exists', async () => {
  nock(GITHUB_API)
    .get('/repos/owner/repo/git/ref/heads%2Fmain')
    .reply(200, { ref: 'refs/heads/main', object: { sha: 'abc123' } });
  const client = new GitHubClient(TOKEN);
  assert.deepEqual(await client.getBranchRef('owner', 'repo', 'main'), { ref: 'refs/heads/main', sha: 'abc123' });
});

test('createBranchRef: creates a ref pointing at the given sha', async () => {
  nock(GITHUB_API)
    .post('/repos/owner/repo/git/refs', (body) => body.ref === 'refs/heads/incident/42/fix-x' && body.sha === 'abc123')
    .reply(201, { ref: 'refs/heads/incident/42/fix-x', object: { sha: 'abc123' } });
  const client = new GitHubClient(TOKEN);
  const ref = await client.createBranchRef('owner', 'repo', 'incident/42/fix-x', 'abc123');
  assert.equal(ref.ref, 'refs/heads/incident/42/fix-x');
});

test('createPullRequest: returns normalized PR info', async () => {
  nock(GITHUB_API)
    .post('/repos/owner/repo/pulls', (body) => body.head === 'incident/42/fix-x' && body.base === 'main')
    .reply(201, { number: 42, url: 'https://api.github.com/repos/owner/repo/pulls/42', html_url: 'https://github.com/owner/repo/pull/42', state: 'open', merged: false });
  const client = new GitHubClient(TOKEN);
  const pr = await client.createPullRequest('owner', 'repo', { title: 'fix: x', body: 'body', head: 'incident/42/fix-x', base: 'main' });
  assert.deepEqual(pr, { number: 42, url: 'https://api.github.com/repos/owner/repo/pulls/42', htmlUrl: 'https://github.com/owner/repo/pull/42', state: 'open', merged: false });
});

test('getPullRequest: fetches a PR by number', async () => {
  nock(GITHUB_API)
    .get('/repos/owner/repo/pulls/42')
    .reply(200, { number: 42, url: 'u', html_url: 'https://github.com/owner/repo/pull/42', state: 'closed', merged: true });
  const client = new GitHubClient(TOKEN);
  const pr = await client.getPullRequest('owner', 'repo', 42);
  assert.equal(pr.state, 'closed');
  assert.equal(pr.merged, true);
});

test('a rate-limit response is classified as RATE_LIMITED', async () => {
  nock(GITHUB_API).get('/repos/owner/repo').reply(403, { message: 'API rate limit exceeded for xxx.' });
  const client = new GitHubClient(TOKEN);
  await assert.rejects(
    () => client.getDefaultBranch('owner', 'repo'),
    (err: unknown) => {
      assert.ok(err instanceof GitHubClientError);
      assert.equal(err.code, 'RATE_LIMITED');
      return true;
    },
  );
});

test('a conflicting ref creation is classified as CONFLICT', async () => {
  nock(GITHUB_API).post('/repos/owner/repo/git/refs').reply(422, { message: 'Reference already exists' });
  const client = new GitHubClient(TOKEN);
  await assert.rejects(
    () => client.createBranchRef('owner', 'repo', 'incident/42/fix-x', 'abc123'),
    (err: unknown) => {
      assert.ok(err instanceof GitHubClientError);
      assert.equal(err.code, 'CONFLICT');
      return true;
    },
  );
});

test('a failed request never leaks the access token', async () => {
  nock(GITHUB_API).get('/repos/owner/repo').reply(404, { message: 'Not Found' });
  const client = new GitHubClient(TOKEN);
  await assert.rejects(
    () => client.getDefaultBranch('owner', 'repo'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(!err.message.includes(TOKEN));
      assert.equal((err as Record<string, unknown>).request, undefined);
      return true;
    },
  );
});
