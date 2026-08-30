import 'dotenv/config';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import nock from 'nock';
import { prisma } from '../src/prisma';
import { startTestServer, seedProjectWithApiKey, cleanupProject } from './helpers';

// repositoryUrl is globally unique, so every test needs its own repo name.
function uniqueRepoName() {
  return `widgets-${randomUUID().slice(0, 8)}`;
}

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

function mockGetRepository(owner: string, name: string, defaultBranch = 'main') {
  nock(GITHUB_API)
    .get(`/repos/${owner}/${name}`)
    .reply(200, { owner: { login: owner }, name, default_branch: defaultBranch, private: false });
}

test('connecting a repository stores it and never returns the token', async () => {
  const { project } = await seed();
  mockGetRepository('acme', 'widgets');

  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: 'https://github.com/acme/widgets.git', accessToken: 'github_pat_super_secret' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();

  assert.equal(body.owner, 'acme');
  assert.equal(body.name, 'widgets');
  assert.equal(body.defaultBranch, 'main');
  assert.equal(body.repositoryUrl, 'https://github.com/acme/widgets');
  assert.equal('accessToken' in body, false);
  assert.equal('encryptedAccessToken' in body, false);

  const stored = await prisma.repository.findUnique({ where: { projectId: project.id } });
  assert.ok(stored);
  assert.notEqual(stored?.encryptedAccessToken, 'github_pat_super_secret');
});

test('SSH-style repository URLs are accepted', async () => {
  const { project } = await seed();
  mockGetRepository('thinklylabs', 'incident-ai');

  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: 'git@github.com:thinklylabs/incident-ai.git', accessToken: 'tok' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.owner, 'thinklylabs');
  assert.equal(body.name, 'incident-ai');
});

test('an invalid repository URL is rejected without calling GitHub', async () => {
  const { project } = await seed();
  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: 'https://gitlab.com/owner/repo', accessToken: 'tok' }),
  });
  assert.equal(res.status, 400);
});

test('a repository GitHub rejects access to is not connected', async () => {
  const { project } = await seed();
  nock(GITHUB_API).get('/repos/acme/private').reply(404, { message: 'Not Found' });

  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: 'https://github.com/acme/private', accessToken: 'bad-token' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(!JSON.stringify(body).includes('bad-token'));
});

test('GET /projects/:projectId/repository returns the connection without the token', async () => {
  const { project } = await seed();
  const repo = uniqueRepoName();
  mockGetRepository('acme', repo);
  const connect = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: `https://github.com/acme/${repo}`, accessToken: 'secret' }),
  });
  assert.equal(connect.status, 201);

  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.owner, 'acme');
  assert.equal('accessToken' in body, false);
  assert.equal('encryptedAccessToken' in body, false);
});

test('GET /projects/:projectId/repository 404s when nothing is connected', async () => {
  const { project } = await seed();
  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository`);
  assert.equal(res.status, 404);
});

test('DELETE disconnects the repository without touching incidents or events', async () => {
  const { project, rawKey } = await seed();
  const repo = uniqueRepoName();
  mockGetRepository('acme', repo);
  const connect = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: `https://github.com/acme/${repo}`, accessToken: 'secret' }),
  });
  assert.equal(connect.status, 201);

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

  const del = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, { method: 'DELETE' });
  assert.equal(del.status, 204);

  const get = await fetch(`${server.baseUrl}/projects/${project.id}/repository`);
  assert.equal(get.status, 404);

  const events = await fetch(`${server.baseUrl}/projects/${project.id}/events`).then((r) => r.json());
  assert.equal(events.pagination.total, 1);
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(incidents.pagination.total, 1);
});

test('repository sync replaces the cached file tree', async () => {
  const { project } = await seed();
  const repo = uniqueRepoName();
  mockGetRepository('acme', repo);
  const connect = await fetch(`${server.baseUrl}/projects/${project.id}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl: `https://github.com/acme/${repo}`, accessToken: 'secret' }),
  });
  assert.equal(connect.status, 201);
  const repository = await prisma.repository.findUniqueOrThrow({ where: { projectId: project.id } });

  nock(GITHUB_API)
    .get(`/repos/acme/${repo}/git/ref/heads%2Fmain`)
    .reply(200, { object: { sha: 'ref-sha' } })
    .get(`/repos/acme/${repo}/git/commits/ref-sha`)
    .reply(200, { tree: { sha: 'tree-sha' } })
    .get(`/repos/acme/${repo}/git/trees/tree-sha`)
    .query({ recursive: 'true' })
    .reply(200, {
      tree: [
        { path: 'src/index.ts', type: 'blob', sha: 'sha-1' },
        { path: 'src', type: 'tree', sha: 'sha-2' },
      ],
    });

  const res = await fetch(`${server.baseUrl}/projects/${project.id}/repository/sync`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fileCount, 2);

  const files = await prisma.repositoryFile.findMany({ where: { repositoryId: repository.id } });
  assert.equal(files.length, 2);
  assert.ok(files.some((f) => f.path === 'src/index.ts' && f.type === 'FILE'));
  assert.ok(files.some((f) => f.path === 'src' && f.type === 'DIRECTORY'));
});
