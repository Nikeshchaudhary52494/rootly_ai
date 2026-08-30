import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import * as github from '../src/github/github.service';

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

test('github service: getRepository returns normalized metadata', async () => {
  nock(GITHUB_API)
    .get('/repos/owner/repository')
    .reply(200, { owner: { login: 'owner' }, name: 'repository', default_branch: 'main', private: false });

  const metadata = await github.getRepository(TOKEN, 'owner', 'repository');
  assert.deepEqual(metadata, { owner: 'owner', name: 'repository', defaultBranch: 'main', private: false });
});

test('github service: getDefaultBranch delegates to getRepository', async () => {
  nock(GITHUB_API)
    .get('/repos/owner/repository')
    .reply(200, { owner: { login: 'owner' }, name: 'repository', default_branch: 'develop', private: false });

  assert.equal(await github.getDefaultBranch(TOKEN, 'owner', 'repository'), 'develop');
});

test('github service: getFileContent decodes base64 file content', async () => {
  const source = 'export const x = 1;\n';
  nock(GITHUB_API)
    .get('/repos/owner/repository/contents/src%2Findex.ts')
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from(source, 'utf8').toString('base64') });

  const content = await github.getFileContent(TOKEN, 'owner', 'repository', 'src/index.ts', 'main');
  assert.equal(content, source);
});

test('github service: getDirectoryTree walks ref -> commit -> tree', async () => {
  nock(GITHUB_API)
    .get('/repos/owner/repository/git/ref/heads%2Fmain')
    .reply(200, { object: { sha: 'ref-sha' } })
    .get('/repos/owner/repository/git/commits/ref-sha')
    .reply(200, { tree: { sha: 'tree-sha' } })
    .get('/repos/owner/repository/git/trees/tree-sha')
    .query({ recursive: 'true' })
    .reply(200, {
      tree: [
        { path: 'src/index.ts', type: 'blob', sha: 'blob-sha' },
        { path: 'src', type: 'tree', sha: 'tree-sha-2' },
      ],
    });

  const entries = await github.getDirectoryTree(TOKEN, 'owner', 'repository', 'main');
  assert.deepEqual(entries, [
    { path: 'src/index.ts', type: 'FILE', sha: 'blob-sha' },
    { path: 'src', type: 'DIRECTORY', sha: 'tree-sha-2' },
  ]);
});

test('github service: getCommitsForFile maps commit summaries', async () => {
  nock(GITHUB_API)
    .get('/repos/owner/repository/commits')
    .query({ path: 'src/index.ts', sha: 'main', per_page: '10' })
    .reply(200, [
      {
        sha: 'abc123',
        commit: {
          message: 'refactor',
          author: { name: 'Jane', email: 'jane@example.com', date: '2026-01-01T00:00:00Z' },
        },
      },
    ]);

  const commits = await github.getCommitsForFile(TOKEN, 'owner', 'repository', 'src/index.ts', 'main');
  assert.deepEqual(commits, [
    { sha: 'abc123', message: 'refactor', authorName: 'Jane', authorEmail: 'jane@example.com', committedAt: '2026-01-01T00:00:00Z' },
  ]);
});

test('github service: a failed request never leaks the access token', async () => {
  nock(GITHUB_API).get('/repos/owner/private-repo').reply(404, { message: 'Not Found' });

  await assert.rejects(
    () => github.getRepository(TOKEN, 'owner', 'private-repo'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Record<string, unknown>).request, undefined);
      assert.equal((err as Record<string, unknown>).response, undefined);
      assert.ok(!err.message.includes(TOKEN));
      return true;
    },
  );
});
