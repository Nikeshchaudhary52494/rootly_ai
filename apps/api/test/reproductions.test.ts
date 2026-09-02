import 'dotenv/config';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import nock from 'nock';
import type { InvestigationLLM, StructuredLLMRequest, StructuredLLMResponse } from '@rootly.ai/agent';
import { prisma } from '../src/prisma';
import { startInvestigation } from '../src/investigations/investigations.service';
import { startReproduction, getReproductionRun, ReproductionPreconditionError } from '../src/reproductions/reproductions.service';
import { startTestServer, seedProjectWithApiKey, cleanupProject } from './helpers';

const GITHUB_API = 'https://api.github.com';

// The real, public monorepo this session is running in — packages/reproduction
// clones it for real (git clone is a subprocess, not something nock can intercept),
// so this test exercises an actual GitHub clone + actual Docker execution.
const REAL_OWNER = 'Nikeshchaudhary52494';
const REAL_REPO = 'rootly_ai';

const PAYMENT_SERVICE_SOURCE = [
  'function confirmPayment(payment) {',
  '  return payment.customer.id;',
  '}',
  '',
  'module.exports = { confirmPayment };',
  '',
].join('\n');

let server: Awaited<ReturnType<typeof startTestServer>>;
let currentCommitSha: string;
const createdProjectIds: string[] = [];

before(async () => {
  server = await startTestServer();
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));

  const { runGit } = await import('@rootly.ai/reproduction');
  const repoRoot = resolve(process.cwd(), '..', '..');
  const result = await runGit(['rev-parse', 'HEAD'], { cwd: repoRoot });
  if (result.exitCode !== 0) throw new Error(`Failed to resolve current commit sha: ${result.stderr}`);
  currentCommitSha = result.stdout.trim();

  // repositoryUrl is globally unique and this file connects the same real,
  // clonable URL in more than one test — clear out any prior connection
  // (e.g. left over from an interrupted run) so a fresh run is never blocked.
  await prisma.repository.deleteMany({ where: { repositoryUrl: `https://github.com/${REAL_OWNER}/${REAL_REPO}` } });
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

function uniqueRepoName() {
  return `repro-${randomUUID().slice(0, 8)}`;
}

/**
 * `owner`/`repo` default to a fresh fake name per call (repositoryUrl is
 * globally unique, and most tests here never reach an actual git clone —
 * only the full end-to-end test below passes the real REAL_OWNER/REAL_REPO
 * so it can exercise a genuine `git clone` against the public repo this
 * session is running in.
 */
async function connectSyncAndCollectContext(
  projectId: string,
  rawKey: string,
  opts: { owner?: string; repo?: string } = {},
) {
  const owner = opts.owner ?? 'acme';
  const repo = opts.repo ?? uniqueRepoName();

  nock(GITHUB_API)
    .get(`/repos/${owner}/${repo}`)
    .reply(200, { owner: { login: owner }, name: repo, default_branch: 'main', private: false });
  const connect = await fetch(`${server.baseUrl}/projects/${projectId}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: `https://github.com/${owner}/${repo}`, accessToken: 'test-token' }),
  });
  assert.equal(connect.status, 201);

  nock(GITHUB_API)
    .get(`/repos/${owner}/${repo}/git/ref/heads%2Fmain`)
    .reply(200, { object: { sha: 'ref-sha' } })
    .get(`/repos/${owner}/${repo}/git/commits/ref-sha`)
    .reply(200, { tree: { sha: 'tree-sha' } })
    .get(`/repos/${owner}/${repo}/git/trees/tree-sha`)
    .query({ recursive: 'true' })
    .reply(200, {
      tree: [
        { path: 'demo-app/src/services/payment.service.js', type: 'blob', sha: 'sha-1' },
        { path: 'demo-app/src/services/payment.service.spec.js', type: 'blob', sha: 'sha-2' },
      ],
    });
  const sync = await fetch(`${server.baseUrl}/projects/${projectId}/repository/sync`, { method: 'POST' });
  assert.equal(sync.status, 200);

  const stack = [
    'TypeError: Cannot read properties of undefined',
    '    at confirmPayment (/app/demo-app/src/services/payment.service.js:2:14)',
  ].join('\n');
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
    .get(`/repos/${owner}/${repo}/contents/demo-app%2Fsrc%2Fservices%2Fpayment.service.js`)
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from(PAYMENT_SERVICE_SOURCE, 'utf8').toString('base64') })
    .get(`/repos/${owner}/${repo}/contents/demo-app%2Fsrc%2Fservices%2Fpayment.service.spec.js`)
    .query({ ref: 'main' })
    .reply(200, {
      type: 'file',
      content: Buffer.from('test("processes a valid payment", () => {});\n', 'utf8').toString('base64'),
    })
    .get(`/repos/${owner}/${repo}/commits`)
    .query({ path: 'demo-app/src/services/payment.service.js', sha: 'main', per_page: '10' })
    .reply(200, [
      {
        sha: currentCommitSha,
        commit: {
          message: 'refactor payment validation',
          author: { name: 'Jane Doe', email: 'jane@example.com', date: '2026-01-01T00:00:00Z' },
        },
      },
    ]);
  const collect = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' }).then((r) =>
    r.json(),
  );
  assert.equal(collect.status, 'READY');

  return incidentId;
}

class ScriptedLLM implements InvestigationLLM {
  private queue: Array<() => unknown> = [];
  calls: StructuredLLMRequest<unknown>[] = [];

  enqueue(raw: () => unknown) {
    this.queue.push(raw);
    return this;
  }

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<StructuredLLMResponse> {
    this.calls.push(request as StructuredLLMRequest<unknown>);
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
      primaryLocation: { file: 'demo-app/src/services/payment.service.js', line: 2 },
      observations: ['payment.customer is undefined when accessed'],
    }))
    .enqueue(() => ({
      observations: [
        {
          description: 'customer.id is accessed without checking that customer is defined',
          sourceFile: 'demo-app/src/services/payment.service.js',
          lineStart: 2,
          lineEnd: 2,
        },
      ],
    }))
    .enqueue(() => ({ observations: [] }))
    .enqueue(() => ({
      hypotheses: [
        { title: 'Missing customer validation', description: 'PaymentService assumes customer always exists.', confidence: 0.85 },
      ],
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
      targetFile: 'demo-app/src/services/payment.service.js',
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
        "const { confirmPayment } = require('../demo-app/src/services/payment.service');",
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

async function waitForTerminalStatus(runId: string, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = await getReproductionRun(runId);
    if (run.status === 'COMPLETED' || run.status === 'FAILED') return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for reproduction run ${runId} to finish`);
}

test(
  'full pipeline: real GitHub clone + real Docker sandbox reproduces the demo bug',
  { timeout: 120000 },
  async () => {
    const { project, rawKey } = await seed();
    const incidentId = await connectSyncAndCollectContext(project.id, rawKey, { owner: REAL_OWNER, repo: REAL_REPO });

    const investigation = await startInvestigation(incidentId, investigationLLM());
    assert.equal(investigation.status, 'COMPLETED');

    const started = await startReproduction(incidentId, reproductionLLM());
    assert.equal(started.status, 'GENERATING_TEST');

    const run = await waitForTerminalStatus(started.id);

    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.result, 'REPRODUCED');
    assert.equal(run.targetCommitSha, currentCommitSha);
    assert.equal(run.testFilePath, 'reproduction-tests/payment-null-customer.spec.js');
    assert.ok(run.generatedTest?.includes('confirmPayment'));
    assert.equal(run.exitCode, 0);
    assert.ok(run.stdout?.includes('PASS') || run.stderr?.includes('PASS'));
    assert.ok((run.durationMs ?? 0) > 0);

    const reproductionTest = await prisma.reproductionTest.findFirst({ where: { reproductionRunId: run.id } });
    assert.ok(reproductionTest);
    assert.equal(reproductionTest?.framework, 'jest');
    assert.equal(reproductionTest?.filePath, 'reproduction-tests/payment-null-customer.spec.js');

    // No lingering sandbox container for this run.
    // (docker-sandbox.test.ts asserts this generically; here we just confirm the DB tells the full story.)
  },
);

test('reproduction is refused before a completed investigation exists', async () => {
  const { project, rawKey } = await seed();
  await connectSyncAndCollectContext(project.id, rawKey);
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id as string;

  await assert.rejects(
    () => startReproduction(incidentId, reproductionLLM()),
    (err: unknown) => {
      assert.ok(err instanceof ReproductionPreconditionError);
      assert.equal(err.code, 'REPRODUCTION_PRECONDITION_FAILED');
      return true;
    },
  );
});

test('POST /incidents/:incidentId/reproduce returns the exact precondition-failure shape', async () => {
  const { project, rawKey } = await seed();
  await connectSyncAndCollectContext(project.id, rawKey);
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id as string;

  const res = await fetch(`${server.baseUrl}/incidents/${incidentId}/reproduce`, { method: 'POST' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'REPRODUCTION_PRECONDITION_FAILED');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

test('GET /reproduction-runs/:id 404s for an unknown run', async () => {
  const res = await fetch(`${server.baseUrl}/reproduction-runs/${randomUUID()}`);
  assert.equal(res.status, 404);
});
