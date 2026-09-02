import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutRepository, RepositoryCheckoutError } from '../src/repository/repository-checkout';

const SECRET_TOKEN = 'ghp_totallySecretTestTokenValue123';

test('a failed checkout never includes the access token in its error message', { timeout: 15000 }, async () => {
  await assert.rejects(
    () =>
      checkoutRepository({
        repositoryUrl: 'https://github.com/this-owner-does-not-exist-xyz/this-repo-does-not-exist-either',
        commitSha: 'main',
        accessToken: SECRET_TOKEN,
        timeoutMs: 10000,
      }),
    (err: unknown) => {
      assert.ok(err instanceof RepositoryCheckoutError);
      assert.ok(!err.message.includes(SECRET_TOKEN), `error message leaked the token: ${err.message}`);
      return true;
    },
  );
});

test('checking out a real public repo strips .git from the resulting workspace', { timeout: 30000 }, async () => {
  const result = await checkoutRepository({
    repositoryUrl: 'https://github.com/Nikeshchaudhary52494/rootly_ai',
    commitSha: 'HEAD',
    timeoutMs: 30000,
  });
  try {
    assert.equal(existsSync(join(result.workspacePath, '.git')), false);
    assert.match(result.resolvedCommitSha, /^[0-9a-f]{40}$/);
  } finally {
    await result.cleanup();
  }
});

test('cleanup() removes the temporary workspace directory', { timeout: 30000 }, async () => {
  const result = await checkoutRepository({
    repositoryUrl: 'https://github.com/Nikeshchaudhary52494/rootly_ai',
    commitSha: 'HEAD',
    timeoutMs: 30000,
  });
  const { workspacePath } = result;
  assert.equal(existsSync(workspacePath), true);
  await result.cleanup();
  assert.equal(existsSync(workspacePath), false);
});

test('an invalid commit sha fails cleanly rather than hanging', { timeout: 30000 }, async () => {
  await assert.rejects(() =>
    checkoutRepository({
      repositoryUrl: 'https://github.com/Nikeshchaudhary52494/rootly_ai',
      commitSha: 'not-a-real-commit-sha-00000000',
      timeoutMs: 30000,
    }),
  );
});
