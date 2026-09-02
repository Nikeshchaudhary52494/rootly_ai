import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineTargetCommit } from '../src/reproduction/target-commit';

test('prefers an explicit code-context commit over everything else', () => {
  const sha = determineTargetCommit({
    codeContextCommitSha: 'pinned-sha',
    recentCommits: [{ sha: 'recent-sha' }],
    defaultBranch: 'main',
  });
  assert.equal(sha, 'pinned-sha');
});

test('falls back to the most recent relevant commit', () => {
  const sha = determineTargetCommit({
    codeContextCommitSha: null,
    recentCommits: [{ sha: 'recent-sha' }, { sha: 'older-sha' }],
    defaultBranch: 'main',
  });
  assert.equal(sha, 'recent-sha');
});

test('falls back to the default branch ref when no commit is known', () => {
  const sha = determineTargetCommit({ codeContextCommitSha: null, recentCommits: [], defaultBranch: 'main' });
  assert.equal(sha, 'main');
});

test('returns null when nothing is available', () => {
  const sha = determineTargetCommit({ codeContextCommitSha: null, recentCommits: [], defaultBranch: null });
  assert.equal(sha, null);
});
