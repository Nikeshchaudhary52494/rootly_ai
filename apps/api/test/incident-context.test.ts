import 'dotenv/config';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import nock from 'nock';
import { prisma } from '../src/prisma';
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

async function connectAndSyncRepository(
  projectId: string,
  opts: { owner?: string; repo?: string; tree: Array<{ path: string; type: 'blob' | 'tree'; sha: string }> },
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
    .reply(200, { tree: opts.tree });

  const sync = await fetch(`${server.baseUrl}/projects/${projectId}/repository/sync`, { method: 'POST' });
  assert.equal(sync.status, 200);

  return { owner, repo };
}

async function createIncidentWithStack(rawKey: string, stack: string, errorMessage = 'Cannot read properties of undefined') {
  const res = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify({
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      service: { name: 'payment-service', environment: 'production' },
      error: { name: 'TypeError', message: errorMessage, stack },
    }),
  });
  assert.equal(res.status, 201);
}

async function getIncidentId(projectId: string) {
  const incidents = await fetch(`${server.baseUrl}/projects/${projectId}/incidents`).then((r) => r.json());
  return incidents.data[0].id as string;
}

const STACK = [
  'TypeError: Cannot read properties of undefined',
  '    at PaymentService.confirm (/app/src/services/payment.service.ts:82:14)',
  '    at PaymentController.confirm (/app/src/controllers/payment.controller.ts:45:10)',
].join('\n');

test('full pipeline: stack trace -> matched file -> code window, related test, commits, status READY', async () => {
  const { project, rawKey } = await seed();
  const { owner, repo } = await connectAndSyncRepository(project.id, {
    tree: [
      { path: 'src/services/payment.service.ts', type: 'blob', sha: 'sha-1' },
      { path: 'src/services/payment.service.spec.ts', type: 'blob', sha: 'sha-2' },
      { path: 'src/controllers/payment.controller.ts', type: 'blob', sha: 'sha-3' },
    ],
  });

  await createIncidentWithStack(rawKey, STACK);
  const incidentId = await getIncidentId(project.id);

  nock(GITHUB_API)
    .get(`/repos/${owner}/${repo}/contents/src%2Fservices%2Fpayment.service.ts`)
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from(paymentServiceSource(), 'utf8').toString('base64') })
    .get(`/repos/${owner}/${repo}/contents/src%2Fservices%2Fpayment.service.spec.ts`)
    .query({ ref: 'main' })
    .reply(200, {
      type: 'file',
      content: Buffer.from('it("processes a valid payment", () => {});\n', 'utf8').toString('base64'),
    })
    .get(`/repos/${owner}/${repo}/commits`)
    .query({ path: 'src/services/payment.service.ts', sha: 'main', per_page: '10' })
    .reply(200, [
      {
        sha: 'commit-1',
        commit: {
          message: 'refactor payment validation',
          author: { name: 'Jane Doe', email: 'jane@example.com', date: '2026-01-01T00:00:00Z' },
        },
      },
    ]);

  const collect = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' });
  assert.equal(collect.status, 200);
  const collectBody = await collect.json();
  assert.equal(collectBody.success, true);
  assert.equal(collectBody.status, 'READY');
  assert.ok(collectBody.contextId);

  const context = await fetch(`${server.baseUrl}/incidents/${incidentId}/context`).then((r) => r.json());
  assert.equal(context.status, 'READY');
  assert.equal(context.primaryLocation.filePath, 'src/services/payment.service.ts');
  assert.equal(context.primaryLocation.lineNumber, 82);

  assert.equal(context.files.length, 1);
  assert.equal(context.files[0].filePath, 'src/services/payment.service.ts');
  assert.equal(context.files[0].isPrimary, true);
  assert.equal(context.files[0].functionName, 'PaymentService.confirm');
  assert.equal(context.files[0].contentStartLine, 62);
  assert.equal(context.files[0].contentEndLine, 100);
  assert.ok(context.files[0].content.includes('payment.customer.id'));

  assert.equal(context.relatedTests.length, 1);
  assert.equal(context.relatedTests[0].filePath, 'src/services/payment.service.spec.ts');
  assert.ok(context.relatedTests[0].content.includes('processes a valid payment'));

  assert.equal(context.recentCommits.length, 1);
  assert.equal(context.recentCommits[0].sha, 'commit-1');
  assert.equal(context.recentCommits[0].message, 'refactor payment validation');
});

test('collecting context without a connected repository returns 400', async () => {
  const { project, rawKey } = await seed();
  await createIncidentWithStack(rawKey, STACK);
  const incidentId = await getIncidentId(project.id);

  const res = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' });
  assert.equal(res.status, 400);
});

test('an unresolvable first frame is skipped in favor of the next resolvable frame', async () => {
  const { project, rawKey } = await seed();
  const { owner, repo } = await connectAndSyncRepository(project.id, {
    tree: [{ path: 'src/services/payment.service.ts', type: 'blob', sha: 'sha-1' }],
  });

  const stackWithNodeModulesFirst = [
    'TypeError: boom',
    '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
    '    at PaymentService.confirm (/app/src/services/payment.service.ts:82:14)',
  ].join('\n');
  await createIncidentWithStack(rawKey, stackWithNodeModulesFirst, 'boom');
  const incidentId = await getIncidentId(project.id);

  nock(GITHUB_API)
    .get(`/repos/${owner}/${repo}/contents/src%2Fservices%2Fpayment.service.ts`)
    .query({ ref: 'main' })
    .reply(200, { type: 'file', content: Buffer.from(paymentServiceSource(), 'utf8').toString('base64') })
    .get(`/repos/${owner}/${repo}/commits`)
    .query({ path: 'src/services/payment.service.ts', sha: 'main', per_page: '10' })
    .reply(200, []);

  const collect = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' }).then((r) =>
    r.json(),
  );
  assert.equal(collect.status, 'READY');

  const context = await fetch(`${server.baseUrl}/incidents/${incidentId}/context`).then((r) => r.json());
  assert.equal(context.primaryLocation.filePath, 'src/services/payment.service.ts');
});

test('no frame matches any repository file -> context status FAILED', async () => {
  const { project, rawKey } = await seed();
  await connectAndSyncRepository(project.id, {
    tree: [{ path: 'src/unrelated.ts', type: 'blob', sha: 'sha-1' }],
  });

  await createIncidentWithStack(rawKey, STACK);
  const incidentId = await getIncidentId(project.id);

  const collect = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' }).then((r) =>
    r.json(),
  );
  assert.equal(collect.status, 'FAILED');

  const context = await fetch(`${server.baseUrl}/incidents/${incidentId}/context`).then((r) => r.json());
  assert.equal(context.status, 'FAILED');
});

test('a GitHub file-fetch failure marks the context FAILED without leaking the token', async () => {
  const { project, rawKey } = await seed();
  const { owner, repo } = await connectAndSyncRepository(project.id, {
    tree: [{ path: 'src/services/payment.service.ts', type: 'blob', sha: 'sha-1' }],
  });

  await createIncidentWithStack(rawKey, STACK);
  const incidentId = await getIncidentId(project.id);

  nock(GITHUB_API)
    .get(`/repos/${owner}/${repo}/contents/src%2Fservices%2Fpayment.service.ts`)
    .query({ ref: 'main' })
    .reply(403, { message: 'Bad credentials' });

  const collect = await fetch(`${server.baseUrl}/incidents/${incidentId}/context/collect`, { method: 'POST' }).then((r) =>
    r.json(),
  );
  assert.equal(collect.status, 'FAILED');

  const context = await fetch(`${server.baseUrl}/incidents/${incidentId}/context`).then((r) => r.json());
  assert.equal(context.status, 'FAILED');
  assert.ok(!JSON.stringify(context).includes('test-token'));
});
