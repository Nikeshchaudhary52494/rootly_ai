import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma';
import { startTestServer, seedProjectWithApiKey, cleanupProject, validEventBody } from './helpers';

let server: Awaited<ReturnType<typeof startTestServer>>;
const createdProjectIds: string[] = [];

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await Promise.all(createdProjectIds.map(cleanupProject));
  await server.close();
  await prisma.$disconnect();
});

async function seed() {
  const seeded = await seedProjectWithApiKey();
  createdProjectIds.push(seeded.project.id);
  return seeded;
}

test('valid API key can ingest an event', async () => {
  const { rawKey } = await seed();
  const res = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody()),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.eventId);
});

test('invalid API key cannot ingest an event', async () => {
  const res = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer iai_live_does_not_exist' },
    body: JSON.stringify(validEventBody()),
  });
  assert.equal(res.status, 401);
});

test('revoked API key cannot ingest an event', async () => {
  const { rawKey, apiKey } = await seed();
  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { revokedAt: new Date() } });

  const res = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody()),
  });
  assert.equal(res.status, 401);
});

test('event automatically gets the correct project and environment from the API key', async () => {
  const { rawKey, project, environment } = await seed();
  const eventId = randomUUID();

  await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody({ eventId })),
  });

  const stored = await prisma.errorEvent.findUnique({ where: { eventId } });
  assert.equal(stored?.projectId, project.id);
  assert.equal(stored?.environmentId, environment.id);
});

test('client cannot override project/environment/apiKeyId via the request body', async () => {
  const { rawKey, project, environment, apiKey } = await seed();
  const other = await seed();
  const eventId = randomUUID();

  await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(
      validEventBody({
        eventId,
        projectId: other.project.id,
        environmentId: other.environment.id,
        apiKeyId: other.apiKey.id,
      }),
    ),
  });

  const stored = await prisma.errorEvent.findUnique({ where: { eventId } });
  assert.equal(stored?.projectId, project.id);
  assert.equal(stored?.environmentId, environment.id);
  assert.equal(stored?.apiKeyId, apiKey.id);
  assert.notEqual(stored?.projectId, other.project.id);
});

test('duplicate eventId does not create a duplicate database record', async () => {
  const { rawKey } = await seed();
  const body = validEventBody();

  const first = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).duplicate, undefined);

  const second = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(body),
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.duplicate, true);
  assert.equal(secondBody.eventId, body.eventId);

  const count = await prisma.errorEvent.count({ where: { eventId: body.eventId } });
  assert.equal(count, 1);
});

test('concurrent duplicate requests still result in exactly one row', async () => {
  const { rawKey } = await seed();
  const body = validEventBody();

  const send = () =>
    fetch(`${server.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify(body),
    });

  const results = await Promise.all([send(), send(), send()]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 201]);

  const count = await prisma.errorEvent.count({ where: { eventId: body.eventId } });
  assert.equal(count, 1);
});

test('invalid event payload is rejected', async () => {
  const { rawKey } = await seed();

  const missingErrorMessage = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody({ error: { name: 'TypeError' } })),
  });
  assert.equal(missingErrorMessage.status, 400);

  const badEventId = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody({ eventId: 'not-a-uuid' })),
  });
  assert.equal(badEventId.status, 400);

  const badTimestamp = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody({ timestamp: 'not-a-date' })),
  });
  assert.equal(badTimestamp.status, 400);
});

test('events can be listed for a project, sorted newest first, with pagination', async () => {
  const { rawKey, project } = await seed();

  for (let i = 0; i < 3; i += 1) {
    await fetch(`${server.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify(validEventBody({ errorName: `Error${i}` })),
    });
  }

  const res = await fetch(`${server.baseUrl}/projects/${project.id}/events`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.length, 3);
  assert.equal(body.pagination.total, 3);
  assert.equal(body.pagination.limit, 50);
  assert.equal(body.pagination.offset, 0);

  const limited = await fetch(`${server.baseUrl}/projects/${project.id}/events?limit=1`);
  const limitedBody = await limited.json();
  assert.equal(limitedBody.data.length, 1);
  assert.equal(limitedBody.pagination.total, 3);
});

test('GET /events/:eventId returns the full event', async () => {
  const { rawKey } = await seed();
  const body = validEventBody();
  const created = await fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(body),
  });
  assert.equal(created.status, 201);

  const stored = await prisma.errorEvent.findUnique({ where: { eventId: body.eventId } });
  const res = await fetch(`${server.baseUrl}/events/${stored!.id}`);
  assert.equal(res.status, 200);
  const detail = await res.json();
  assert.equal(detail.eventId, body.eventId);
  assert.equal(detail.stackTrace, body.error.stack);
});
