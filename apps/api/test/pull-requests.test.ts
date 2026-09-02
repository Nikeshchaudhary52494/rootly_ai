import 'dotenv/config';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nock from 'nock';
import type { InvestigationLLM, StructuredLLMRequest, StructuredLLMResponse } from '@incident-ai/agent';
import type { GitHubClient, GitHubRef, GitHubPullRequestInfo } from '@incident-ai/github';
import { computePatchHash } from '@incident-ai/github';
import { renderUnifiedDiff } from '@incident-ai/fix-engine';
import { prisma } from '../src/prisma';
import { RepositoryProvider, FixStatus, FixResult } from '../src/generated/prisma/client';
import { encryptToken } from '../src/github/utils/github-token-crypto';
import { startInvestigation } from '../src/investigations/investigations.service';
import { startReproduction, getReproductionRun } from '../src/reproductions/reproductions.service';
import { startFixAttempt, getFixAttempt } from '../src/fix-attempts/fix-attempts.service';
import { startPrCreation, getPullRequest, PrCreationError } from '../src/pull-requests/pull-requests.service';
import { startTestServer, seedProjectWithApiKey, cleanupProject } from './helpers';

const GITHUB_API = 'https://api.github.com';
const OWNER = 'acme';
const REPO_NAME = 'demo-repo';

const execFileAsync = promisify(execFile);

const PAYMENT_SERVICE_SOURCE = [
  'function confirmPayment(payment) {',
  '  return payment.customer.id;',
  '}',
  '',
  'module.exports = { confirmPayment };',
  '',
].join('\n');

/**
 * pull-requests.service.ts ends in a real `git push`. Rather than requiring
 * live GitHub credentials (and never pushing to a real repository from an
 * automated test — see packages/github/README.md), this seeds a local bare
 * git repo and points `Repository.repositoryUrl` at it directly via Prisma
 * (the real `/projects/:id/repository` endpoint always normalizes the URL to
 * `https://github.com/...`, so a local path can only get in this way). All
 * GitHub REST calls (code context collection, branch lookup, PR creation)
 * stay nock-mocked exactly like every other test in this file/project.
 */
class FakeGitHubClient {
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
    await execFileAsync('git', ['-C', this.bareRepoPath, 'branch', branch, fromSha]);
    return { ref: `refs/heads/${branch}`, sha: fromSha };
  }

  async createPullRequest(): Promise<GitHubPullRequestInfo> {
    this.createPullRequestCalls += 1;
    return {
      number: 101,
      url: `https://api.github.com/repos/${OWNER}/${REPO_NAME}/pulls/101`,
      htmlUrl: `https://github.com/${OWNER}/${REPO_NAME}/pull/101`,
      state: 'open',
      merged: false,
    };
  }
}

async function git(args: string[], cwd: string) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function makeBareRepo(): Promise<{ bareRepoPath: string; commitSha: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'incident-ai-pr-test-'));
  const bareRepoPath = join(root, 'origin.git');
  const seedPath = join(root, 'seed');

  await execFileAsync('git', ['init', '--bare', '--quiet', '-b', 'main', bareRepoPath]);
  await execFileAsync('git', ['clone', '--quiet', bareRepoPath, seedPath]);
  // The sandbox image's global `jest` CLI needs a package.json to anchor its rootDir —
  // without one it fails outright with "Could not find a config file", before ever
  // running a test. The real project repo used elsewhere in this session has one at
  // its root for the same reason; this synthetic repo needs its own.
  await writeFile(join(seedPath, 'package.json'), JSON.stringify({ name: 'demo-repo', version: '1.0.0' }, null, 2) + '\n', 'utf8');
  await writeFile(join(seedPath, 'payment.service.js'), PAYMENT_SERVICE_SOURCE, 'utf8');
  await writeFile(join(seedPath, 'payment.service.spec.js'), 'test("processes a valid payment", () => {});\n', 'utf8');
  await git(['add', '-A'], seedPath);
  await git(['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', 'commit', '--quiet', '-m', 'init'], seedPath);
  await git(['push', '--quiet', 'origin', 'main'], seedPath);
  const commitSha = await git(['rev-parse', 'HEAD'], seedPath);
  await rm(seedPath, { recursive: true, force: true });

  return { bareRepoPath, commitSha, cleanup: () => rm(root, { recursive: true, force: true }) };
}

let server: Awaited<ReturnType<typeof startTestServer>>;
const createdProjectIds: string[] = [];

before(async () => {
  server = await startTestServer();
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));
});

after(async () => {
  nock.enableNetConnect();
  await Promise.all(createdProjectIds.map(cleanupProject));
  await server.close();
  await prisma.$disconnect();
});

afterEach(() => {
  nock.cleanAll();
});

async function seed() {
  const seeded = await seedProjectWithApiKey();
  createdProjectIds.push(seeded.project.id);
  return seeded;
}

async function connectLocalRepoAndCollectContext(projectId: string, rawKey: string, bareRepoPath: string, commitSha: string) {
  await prisma.repository.create({
    data: {
      projectId,
      provider: RepositoryProvider.GITHUB,
      owner: OWNER,
      name: REPO_NAME,
      repositoryUrl: bareRepoPath,
      defaultBranch: 'main',
      encryptedAccessToken: encryptToken('unused-local-repo-token'),
      lastValidatedAt: new Date(),
    },
  });

  nock(GITHUB_API)
    .get(`/repos/${OWNER}/${REPO_NAME}/git/ref/heads%2Fmain`)
    .reply(200, { object: { sha: 'ref-sha' } })
    .get(`/repos/${OWNER}/${REPO_NAME}/git/commits/ref-sha`)
    .reply(200, { tree: { sha: 'tree-sha' } })
    .get(`/repos/${OWNER}/${REPO_NAME}/git/trees/tree-sha`)
    .query({ recursive: 'true' })
    .reply(200, {
      tree: [
        { path: 'payment.service.js', type: 'blob', sha: 'sha-1' },
        { path: 'payment.service.spec.js', type: 'blob', sha: 'sha-2' },
      ],
    });
  const sync = await fetch(`${server.baseUrl}/projects/${projectId}/repository/sync`, { method: 'POST' });
  assert.equal(sync.status, 200);

  const stack = ['TypeError: Cannot read properties of undefined', '    at confirmPayment (/app/payment.service.js:2:14)'].join('\n');
  const event = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify({
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      service: { name: 'payment-service', environment: 'production' },
      error: { name: 'TypeError', message: "Cannot read properties of undefined (reading 'id')", stack },
    }),
  });
  assert.equal(event.status, 201);

  const incidents = await fetch(`${server.baseUrl}/projects/${projectId}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id as string;

  nock(GITHUB_API)
    .get(`/repos/${OWNER}/${REPO_NAME}/contents/payment.service.js`)
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from(PAYMENT_SERVICE_SOURCE, 'utf8').toString('base64') })
    .get(`/repos/${OWNER}/${REPO_NAME}/contents/payment.service.spec.js`)
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from('test("processes a valid payment", () => {});\n', 'utf8').toString('base64') })
    .get(`/repos/${OWNER}/${REPO_NAME}/commits`)
    .query({ path: 'payment.service.js', sha: 'main', per_page: '10' })
    .reply(200, [
      { sha: commitSha, commit: { message: 'init', author: { name: 'Seed', email: 'seed@example.com', date: '2026-01-01T00:00:00Z' } } },
    ]);
  const collect = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' }).then((r) => r.json());
  assert.equal(collect.status, 'READY');

  return incidentId;
}

class ScriptedLLM implements InvestigationLLM {
  private queue: Array<() => unknown> = [];

  enqueue(raw: () => unknown) {
    this.queue.push(raw);
    return this;
  }

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<StructuredLLMResponse> {
    const next = this.queue.shift();
    if (!next) throw new Error(`ScriptedLLM: no response queued for ${request.schemaName}`);
    return { raw: next(), usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 } };
  }
}

function investigationLLM() {
  return new ScriptedLLM()
    .enqueue(() => ({
      errorType: 'TypeError',
      normalizedMessage: "Cannot read properties of undefined (reading 'id')",
      primaryLocation: { file: 'payment.service.js', line: 2 },
      observations: ['payment.customer is undefined when accessed'],
    }))
    .enqueue(() => ({
      observations: [
        { description: 'customer.id is accessed without checking that customer is defined', sourceFile: 'payment.service.js', lineStart: 2, lineEnd: 2 },
      ],
    }))
    .enqueue(() => ({ observations: [] }))
    .enqueue(() => ({
      hypotheses: [{ title: 'Missing customer validation', description: 'PaymentService assumes customer always exists.', confidence: 0.85 }],
    }))
    .enqueue(() => ({
      evaluations: [
        {
          hypothesisIndex: 0,
          supportingEvidenceIds: ['error-message', 'stack-trace-location', 'code-0'],
          contradictingEvidenceIds: [],
          missingEvidence: [],
          revisedConfidence: 0.91,
          status: 'LIKELY',
        },
      ],
    }))
    .enqueue(() => ({
      summary: 'PaymentService accesses customer.id without validating customer.',
      rootCause: 'The payment confirmation path assumes customer is always present.',
      impact: 'Requests containing a payment without a customer fail with TypeError.',
      recommendation: 'Validate customer before accessing customer.id.',
    }));
}

function reproductionLLM() {
  return new ScriptedLLM()
    .enqueue(() => ({
      targetFile: 'payment.service.js',
      targetFunctionOrExport: 'confirmPayment',
      failureCondition: 'payment.customer is null or undefined',
      expectedFailureType: 'TypeError',
      reproductionApproach: 'Call confirmPayment with a payment whose customer is null and expect it to throw.',
    }))
    .enqueue(() => ({
      filePath: 'reproduction-tests/payment-null-customer.spec.js',
      testName: 'reproduces crash when payment has no customer',
      language: 'javascript',
      framework: 'jest',
      content: [
        "const { confirmPayment } = require('../payment.service');",
        '',
        "describe('payment null customer reproduction', () => {",
        "  it('reproduces crash when payment has no customer', () => {",
        "    const payment = { id: 'payment-123', customer: null };",
        '    expect(() => confirmPayment(payment)).toThrow(TypeError);',
        '  });',
        '});',
        '',
      ].join('\n'),
      explanation: 'customer is null so payment.customer.id throws a TypeError, matching the production incident.',
    }));
}

function fixLLM() {
  return new ScriptedLLM()
    .enqueue(() => ({
      targetFile: 'payment.service.js',
      targetFunctionOrExport: 'confirmPayment',
      rootCauseSummary: 'customer can be undefined before .id is accessed.',
      proposedApproach: 'Use optional chaining and a null fallback so a missing customer no longer throws.',
    }))
    .enqueue(() => ({
      summary: 'Guard against a missing customer before accessing .id.',
      rootCause: 'customer can be undefined when a payment has no associated customer.',
      changes: [
        {
          filePath: 'payment.service.js',
          startLine: 2,
          endLine: 2,
          originalCode: '  return payment.customer.id;',
          replacementCode: '  return payment.customer?.id ?? null;',
          explanation: 'Use optional chaining so a missing customer returns null instead of throwing.',
        },
      ],
      patch: '--- a/payment.service.js\n+++ b/payment.service.js\n',
      testsExpectedToPass: ['reproduction-tests/payment-null-customer.spec.js'],
      risks: ['Callers that previously relied on the TypeError being thrown would now see null.'],
    }))
    .enqueue(() => ({
      filePath: 'reproduction-tests/payment-null-customer.spec.js',
      content: [
        "const { confirmPayment } = require('../payment.service');",
        '',
        "describe('payment null customer reproduction', () => {",
        "  it('no longer throws when payment has no customer', () => {",
        "    const payment = { id: 'payment-123', customer: null };",
        '    expect(() => confirmPayment(payment)).not.toThrow();',
        '    expect(confirmPayment(payment)).toBeNull();',
        '  });',
        '});',
        '',
      ].join('\n'),
      testName: 'no longer throws when payment has no customer',
      expectedBehavior: 'confirmPayment returns null instead of throwing when customer is missing.',
    }));
}

async function waitForTerminalStatus<T extends { status: string }>(fetchFn: () => Promise<T>, timeoutMs = 150000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const record = await fetchFn();
    if (record.status === 'COMPLETED' || record.status === 'FAILED') return record;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for terminal status');
}

async function driveIncidentToFixVerified(bareRepoPath: string, commitSha: string) {
  const { project, rawKey } = await seed();
  const incidentId = await connectLocalRepoAndCollectContext(project.id, rawKey, bareRepoPath, commitSha);

  const investigation = await startInvestigation(incidentId, investigationLLM());
  assert.equal(investigation.status, 'COMPLETED');

  const reproStarted = await startReproduction(incidentId, reproductionLLM());
  const repro = await waitForTerminalStatus(() => getReproductionRun(reproStarted.id));
  assert.equal(repro.result, 'REPRODUCED');

  const fixStarted = await startFixAttempt(incidentId, fixLLM());
  const fix = await waitForTerminalStatus(() => getFixAttempt(fixStarted.id));
  assert.equal(fix.result, 'FIX_VERIFIED');

  return { incidentId, fixAttemptId: fix.id };
}

/**
 * Directly seeds a FixAttempt (plus the Investigation/ReproductionRun rows it
 * requires as foreign keys) without running the real LLM/Docker pipeline —
 * for tests that only care about precondition/security behavior around an
 * *existing* FixAttempt, not about generating one. `result` lets a test
 * produce a FIX_REJECTED/INCONCLUSIVE row cheaply, which the real pipeline
 * has no scripted path to reliably force.
 */
async function seedFixAttempt(incidentId: string, result: FixResult, targetCommitSha = 'deadbeef') {
  const investigation = await prisma.investigation.create({
    data: { incidentId, status: 'COMPLETED', model: 'gpt-4o-mini', summary: 'root cause', finalConfidence: 0.9 },
  });
  const reproductionRun = await prisma.reproductionRun.create({
    data: { incidentId, investigationId: investigation.id, status: 'COMPLETED', result: 'REPRODUCED' },
  });

  const patchedSource = PAYMENT_SERVICE_SOURCE.replace('payment.customer.id', 'payment.customer?.id ?? null');
  const diff = renderUnifiedDiff('payment.service.js', PAYMENT_SERVICE_SOURCE, patchedSource);
  const patch = diff;

  const fixAttempt = await prisma.fixAttempt.create({
    data: {
      incidentId,
      investigationId: investigation.id,
      reproductionRunId: reproductionRun.id,
      status: FixStatus.COMPLETED,
      result,
      targetCommitSha,
      patch: result === 'FIX_VERIFIED' ? patch : null,
      validatedPatchHash: result === 'FIX_VERIFIED' ? computePatchHash(patch) : null,
      changedFiles: result === 'FIX_VERIFIED' ? ['payment.service.js'] : [],
      explanation: 'Guard against a missing customer before accessing .id.',
    },
  });

  if (result === 'FIX_VERIFIED') {
    await prisma.fixPatch.create({
      data: { fixAttemptId: fixAttempt.id, filePath: 'payment.service.js', originalContent: PAYMENT_SERVICE_SOURCE, patchedContent: patchedSource, diff },
    });
  }

  return fixAttempt;
}

test(
  'full pipeline: a FIX_VERIFIED attempt is promoted to a real branch, commit, and (mocked) GitHub PR',
  { timeout: 180000 },
  async () => {
    const repo = await makeBareRepo();
    try {
      const { incidentId } = await driveIncidentToFixVerified(repo.bareRepoPath, repo.commitSha);

      const client = new FakeGitHubClient(repo.bareRepoPath);
      const started = await startPrCreation(incidentId, client as unknown as GitHubClient);
      assert.equal(started.status, 'CREATING');

      // Poll until OPEN or FAILED — PullRequestStatus has no single generic "terminal" value
      // the way FixStatus/ReproductionStatus do, so this waits on CREATING specifically.
      const startedAt = Date.now();
      let final = await getPullRequest(started.id);
      while (final.status === 'CREATING' && Date.now() - startedAt < 60000) {
        await new Promise((r) => setTimeout(r, 500));
        final = await getPullRequest(started.id);
      }

      assert.equal(final.status, 'OPEN', final.errorMessage ?? undefined);
      const incidentRow = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
      assert.equal(final.branchName, `incident/${incidentRow.sequenceNumber}/fix-guard-against-a-missing-customer-before`);
      assert.equal(final.baseBranch, 'main');
      assert.equal(final.prNumber, 101);
      assert.equal(final.prUrl, `https://github.com/${OWNER}/${REPO_NAME}/pull/101`);
      assert.ok(final.commitSha && final.commitSha !== repo.commitSha);
      assert.match(final.title, /^fix:/);
      assert.match(final.body, /Incident #/);
      assert.match(final.body, /payment\.service\.js/);

      const branchContent = await git(['show', `${final.branchName}:payment.service.js`], repo.bareRepoPath);
      assert.match(branchContent, /payment\.customer\?\.id/);

      const mainSha = await git(['rev-parse', 'main'], repo.bareRepoPath);
      assert.equal(mainSha, repo.commitSha, 'the default branch must never be modified directly');

      assert.equal(client.createPullRequestCalls, 1);

      // Idempotency: calling again for the same FixAttempt must return the same PR, not create a second one.
      const again = await startPrCreation(incidentId, client as unknown as GitHubClient);
      assert.equal(again.id, started.id);
      assert.equal(client.createPullRequestCalls, 1);
    } finally {
      await repo.cleanup();
    }
  },
);

test('PR creation is refused when no FIX_VERIFIED attempt exists', async () => {
  const repo = await makeBareRepo();
  try {
    const { project, rawKey } = await seed();
    const incidentId = await connectLocalRepoAndCollectContext(project.id, rawKey, repo.bareRepoPath, repo.commitSha);

    await assert.rejects(
      () => startPrCreation(incidentId),
      (err: unknown) => {
        assert.ok(err instanceof PrCreationError);
        assert.equal(err.code, 'PR_CREATION_PRECONDITION_FAILED');
        return true;
      },
    );
  } finally {
    await repo.cleanup();
  }
});

test('POST /incidents/:incidentId/create-pr returns the exact precondition-failure shape', async () => {
  const repo = await makeBareRepo();
  try {
    const { project, rawKey } = await seed();
    const incidentId = await connectLocalRepoAndCollectContext(project.id, rawKey, repo.bareRepoPath, repo.commitSha);

    const res = await fetch(`${server.baseUrl}/incidents/${incidentId}/create-pr`, { method: 'POST' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'PR_CREATION_PRECONDITION_FAILED');
    assert.ok(typeof body.message === 'string' && body.message.length > 0);
  } finally {
    await repo.cleanup();
  }
});

test('a patch hash mismatch blocks promotion (PATCH_INTEGRITY_FAILED)', async () => {
  const repo = await makeBareRepo();
  try {
    const { incidentId, fixAttemptId } = await driveIncidentToFixVerified(repo.bareRepoPath, repo.commitSha);

    // Simulate the FixAttempt.patch field being altered after Phase 7 validation.
    await prisma.fixAttempt.update({ where: { id: fixAttemptId }, data: { patch: 'tampered patch content' } });

    await assert.rejects(
      () => startPrCreation(incidentId),
      (err: unknown) => {
        assert.ok(err instanceof PrCreationError);
        assert.equal(err.code, 'PATCH_INTEGRITY_FAILED');
        return true;
      },
    );
  } finally {
    await repo.cleanup();
  }
});

test('GET /pull-requests/:id 404s for an unknown pull request', async () => {
  const res = await fetch(`${server.baseUrl}/pull-requests/${randomUUID()}`);
  assert.equal(res.status, 404);
});

test('PR creation is refused when the latest fix attempt is FIX_REJECTED', async () => {
  const repo = await makeBareRepo();
  try {
    const { project, rawKey } = await seed();
    const incidentId = await connectLocalRepoAndCollectContext(project.id, rawKey, repo.bareRepoPath, repo.commitSha);
    await seedFixAttempt(incidentId, FixResult.FIX_REJECTED);

    await assert.rejects(
      () => startPrCreation(incidentId),
      (err: unknown) => {
        assert.ok(err instanceof PrCreationError);
        assert.equal(err.code, 'PR_CREATION_PRECONDITION_FAILED');
        return true;
      },
    );
  } finally {
    await repo.cleanup();
  }
});

test('PR creation is refused when the latest fix attempt is INCONCLUSIVE', async () => {
  const repo = await makeBareRepo();
  try {
    const { project, rawKey } = await seed();
    const incidentId = await connectLocalRepoAndCollectContext(project.id, rawKey, repo.bareRepoPath, repo.commitSha);
    await seedFixAttempt(incidentId, FixResult.INCONCLUSIVE);

    await assert.rejects(
      () => startPrCreation(incidentId),
      (err: unknown) => {
        assert.ok(err instanceof PrCreationError);
        assert.equal(err.code, 'PR_CREATION_PRECONDITION_FAILED');
        return true;
      },
    );
  } finally {
    await repo.cleanup();
  }
});

test('the GitHub access token never appears in a log line or the API response during PR creation', { timeout: 30000 }, async () => {
  const repo = await makeBareRepo();
  const rawToken = 'unused-local-repo-token';
  const capturedLines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    originalLog(...args);
  };

  try {
    const { project, rawKey } = await seed();
    const incidentId = await connectLocalRepoAndCollectContext(project.id, rawKey, repo.bareRepoPath, repo.commitSha);
    await seedFixAttempt(incidentId, FixResult.FIX_VERIFIED, repo.commitSha);

    const client = new FakeGitHubClient(repo.bareRepoPath);
    const started = await startPrCreation(incidentId, client as unknown as GitHubClient);

    const startedAt = Date.now();
    let final = await getPullRequest(started.id);
    while (final.status === 'CREATING' && Date.now() - startedAt < 15000) {
      await new Promise((r) => setTimeout(r, 200));
      final = await getPullRequest(started.id);
    }
    assert.equal(final.status, 'OPEN', final.errorMessage ?? undefined);

    for (const line of capturedLines) {
      assert.ok(!line.includes(rawToken), `log line leaked the access token: ${line}`);
    }

    const responseText = JSON.stringify(final);
    assert.ok(!responseText.includes(rawToken), 'API response leaked the access token');
    assert.ok(!('accessToken' in final) && !('encryptedAccessToken' in final), 'API response exposed a token field');
  } finally {
    console.log = originalLog;
    await repo.cleanup();
  }
});
