import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, generateBranchName, resolveUniqueBranchName } from '../src/branch/branch-manager';
import type { GitHubClient, GitHubRef } from '../src/client/github-client';

test('slugify: lowercases and replaces spaces with dashes', () => {
  assert.equal(slugify('Fix Null Customer'), 'fix-null-customer');
});

test('slugify: strips unsafe characters, including path traversal segments', () => {
  assert.equal(slugify('../../etc/passwd; rm -rf /'), 'etcpasswd-rm-rf');
});

// A malicious or malformed fix explanation (AI-generated text) is exactly the kind of input
// slugify sees in practice (see generateBranchName's caller) — this is the security property
// that matters: whatever text goes in, no "..", "/", or backslash can ever come out.
test('slugify: never produces path traversal or path-separator characters for any input', () => {
  const malicious = ['../../../etc/passwd', '..\\..\\windows\\system32', 'a/../../b', '....//....//', '~/.ssh/id_rsa', 'C:\\Windows'];
  for (const input of malicious) {
    const slug = slugify(input);
    assert.ok(!slug.includes('..'), `slugify(${JSON.stringify(input)}) = ${JSON.stringify(slug)} contains ".."`);
    assert.ok(!slug.includes('/'), `slugify(${JSON.stringify(input)}) = ${JSON.stringify(slug)} contains "/"`);
    assert.ok(!slug.includes('\\'), `slugify(${JSON.stringify(input)}) = ${JSON.stringify(slug)} contains "\\"`);
  }
});

test('generateBranchName: never lets the seed text escape the incident/<n>/fix- prefix', () => {
  const branch = generateBranchName(42, '../../../../etc/passwd');
  assert.match(branch, /^incident\/42\/fix-[a-z0-9-]+$/);
});

test('slugify: collapses repeated whitespace/dashes and trims edges', () => {
  assert.equal(slugify('  weird   --  spacing  '), 'weird-spacing');
});

test('slugify: truncates to a maximum reasonable length', () => {
  const long = 'a'.repeat(200);
  const slug = slugify(long);
  assert.ok(slug.length <= 40);
});

test('slugify: falls back to "fix" for input with no safe characters', () => {
  assert.equal(slugify('!!!???'), 'fix');
});

test('generateBranchName: deterministic, lowercase, incident-scoped', () => {
  assert.equal(generateBranchName(42, 'handle null customer'), 'incident/42/fix-handle-null-customer');
});

class FakeGitHubClient {
  constructor(private readonly existing: Set<string>) {}
  async getBranchRef(_owner: string, _repo: string, branch: string): Promise<GitHubRef | null> {
    return this.existing.has(branch) ? { ref: `refs/heads/${branch}`, sha: 'deadbeef' } : null;
  }
}

test('resolveUniqueBranchName: returns the candidate unchanged when it does not exist', async () => {
  const client = new FakeGitHubClient(new Set()) as unknown as GitHubClient;
  const name = await resolveUniqueBranchName(client, 'acme', 'repo', 'incident/42/fix-null-customer');
  assert.equal(name, 'incident/42/fix-null-customer');
});

test('resolveUniqueBranchName: appends -2 when the candidate already exists', async () => {
  const client = new FakeGitHubClient(new Set(['incident/42/fix-null-customer'])) as unknown as GitHubClient;
  const name = await resolveUniqueBranchName(client, 'acme', 'repo', 'incident/42/fix-null-customer');
  assert.equal(name, 'incident/42/fix-null-customer-2');
});

test('resolveUniqueBranchName: keeps incrementing past multiple collisions', async () => {
  const client = new FakeGitHubClient(
    new Set(['incident/42/fix-x', 'incident/42/fix-x-2', 'incident/42/fix-x-3']),
  ) as unknown as GitHubClient;
  const name = await resolveUniqueBranchName(client, 'acme', 'repo', 'incident/42/fix-x');
  assert.equal(name, 'incident/42/fix-x-4');
});
