import 'dotenv/config';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import nock from 'nock';
import type { InvestigationLLM, StructuredLLMRequest, StructuredLLMResponse } from '@incident-ai/agent';
import { prisma } from '../src/prisma';
import { startInvestigation, getInvestigation, listIncidentInvestigations } from '../src/investigations/investigations.service';
import { startTestServer, seedProjectWithApiKey, cleanupProject } from './helpers';

const GITHUB_API = 'https://api.github.com';

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

function uniqueRepoName() {
  return `svc-${randomUUID().slice(0, 8)}`;
}

function paymentServiceSource() {
  const lines = Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`);
  lines[0] = 'export function confirmPayment(payment) {';
  lines[81] = '  return payment.customer.id;';
  lines[99] = '}';
  return lines.join('\n');
}

async function connectSyncAndCollectContext(projectId: string, rawKey: string) {
  const owner = 'acme';
  const repo = uniqueRepoName();

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
        { path: 'src/services/payment.service.js', type: 'blob', sha: 'sha-1' },
        { path: 'src/services/payment.service.spec.js', type: 'blob', sha: 'sha-2' },
      ],
    });
  const sync = await fetch(`${server.baseUrl}/projects/${projectId}/repository/sync`, { method: 'POST' });
  assert.equal(sync.status, 200);

  const stack = [
    'TypeError: Cannot read properties of undefined',
    `    at confirmPayment (/app/src/services/payment.service.js:82:14)`,
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
    .get(`/repos/${owner}/${repo}/contents/src%2Fservices%2Fpayment.service.js`)
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from(paymentServiceSource(), 'utf8').toString('base64') })
    .get(`/repos/${owner}/${repo}/contents/src%2Fservices%2Fpayment.service.spec.js`)
    .query({ ref: 'main' })
    .reply(200, {
      type: 'file',
      content: Buffer.from('test("valid payment", () => {});\n', 'utf8').toString('base64'),
    })
    .get(`/repos/${owner}/${repo}/commits`)
    .query({ path: 'src/services/payment.service.js', sha: 'main', per_page: '10' })
    .reply(200, [
      {
        sha: 'commit-1',
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

function happyPathLLM() {
  return new ScriptedLLM()
    .enqueue(() => ({
      errorType: 'TypeError',
      normalizedMessage: "Cannot read properties of undefined (reading 'id')",
      primaryLocation: { file: 'src/services/payment.service.js', line: 82 },
      observations: ['payment.customer is undefined when accessed'],
    }))
    .enqueue(() => ({
      observations: [
        {
          description: 'customer.id is accessed without checking that customer is defined',
          sourceFile: 'src/services/payment.service.js',
          lineStart: 82,
          lineEnd: 82,
        },
      ],
    }))
    .enqueue(() => ({
      observations: [{ commitSha: 'commit-1', description: 'changed customer validation behavior', relevance: 0.6 }],
    }))
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
          missingEvidence: ['Whether the API contract guarantees a customer is present.'],
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

test('starting an investigation persists Investigation, hypotheses, and grounded evidence', async () => {
  const { project, rawKey } = await seed();
  const incidentId = await connectSyncAndCollectContext(project.id, rawKey);

  const result = await startInvestigation(incidentId, happyPathLLM());
  assert.equal(result.status, 'COMPLETED');

  const stored = await prisma.investigation.findUnique({
    where: { id: result.investigationId },
    include: { hypotheses: { include: { evidence: true } } },
  });
  assert.ok(stored);
  assert.equal(stored?.status, 'COMPLETED');
  assert.equal(stored?.finalConfidence, 0.91);
  assert.ok(stored?.summary);
  assert.equal(stored?.totalTokens, 35 * 6);
  assert.equal(stored?.hypotheses.length, 1);
  assert.equal(stored?.hypotheses[0].status, 'LIKELY');
  assert.equal(stored?.hypotheses[0].rank, 1);

  const evidence = stored?.hypotheses[0].evidence ?? [];
  assert.ok(evidence.length > 0);
  assert.ok(evidence.every((e) => e.type === 'SUPPORTING'));
  assert.ok(evidence.some((e) => e.sourceReference === 'src/services/payment.service.js' && e.lineStart === 82));

  const viaApi = await getInvestigation(result.investigationId);
  assert.equal(viaApi.status, 'COMPLETED');
  assert.equal(viaApi.hypotheses.length, 1);
  assert.equal(viaApi.evidence.length, evidence.length);

  const res = await fetch(`${server.baseUrl}/investigations/${result.investigationId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'COMPLETED');
  assert.equal(body.hypotheses[0].title, 'Missing customer validation');
});

test('an incident with no code context fails the investigation without calling the LLM, and is not left RUNNING', async () => {
  const { project, rawKey } = await seed();

  await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify({
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      service: { name: 'svc', environment: 'production' },
      error: { name: 'Error', message: 'boom' },
    }),
  });
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id as string;

  const llm = new ScriptedLLM();
  const result = await startInvestigation(incidentId, llm);

  assert.equal(result.status, 'FAILED');
  assert.equal(llm.calls.length, 0);

  const stored = await prisma.investigation.findUnique({ where: { id: result.investigationId } });
  assert.equal(stored?.status, 'FAILED');
  assert.ok(stored?.errorMessage?.includes('Code context has not been collected'));
  assert.notEqual(stored?.status, 'RUNNING');
});

test('multiple investigation runs on the same incident are kept, not overwritten', async () => {
  const { project, rawKey } = await seed();
  const incidentId = await connectSyncAndCollectContext(project.id, rawKey);

  const first = await startInvestigation(incidentId, happyPathLLM());
  const second = await startInvestigation(incidentId, happyPathLLM());
  assert.notEqual(first.investigationId, second.investigationId);

  const list = await listIncidentInvestigations(incidentId);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.investigationId); // createdAt desc
  assert.equal(list[1].id, first.investigationId);
});

test('a missing OPENAI_API_KEY fails the investigation cleanly instead of leaving it RUNNING', async () => {
  const { project, rawKey } = await seed();
  const incidentId = await connectSyncAndCollectContext(project.id, rawKey);

  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const res = await fetch(`${server.baseUrl}/incidents/${incidentId}/investigate`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'FAILED');

    const stored = await prisma.investigation.findUnique({ where: { id: body.investigationId } });
    assert.equal(stored?.status, 'FAILED');
    assert.ok(stored?.errorMessage?.includes('OPENAI_API_KEY'));
  } finally {
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  }
});

test('GET /investigations/:id 404s for an unknown investigation', async () => {
  const res = await fetch(`${server.baseUrl}/investigations/${randomUUID()}`);
  assert.equal(res.status, 404);
});
