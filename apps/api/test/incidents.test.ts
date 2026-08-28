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

function sendEvent(rawKey: string, overrides: Record<string, unknown> = {}) {
  return fetch(`${server.baseUrl}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(validEventBody(overrides)),
  });
}

test('the same logical error repeated many times groups into a single incident', async () => {
  const { rawKey, project } = await seed();

  for (let i = 0; i < 100; i += 1) {
    const res = await sendEvent(rawKey, { eventId: randomUUID() });
    assert.equal(res.status, 201);
  }

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(incidents.data.length, 1);
  assert.equal(incidents.data[0].occurrenceCount, 100);
  assert.equal(incidents.data[0].status, 'OPEN');

  const eventCount = await prisma.errorEvent.count({ where: { projectId: project.id } });
  assert.equal(eventCount, 100);
});

test('dynamic values in the message normalize into a single incident', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, {
    eventId: randomUUID(),
    error: { name: 'Error', message: 'User 123 not found' },
  });
  await sendEvent(rawKey, {
    eventId: randomUUID(),
    error: { name: 'Error', message: 'User 456 not found' },
  });

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(incidents.data.length, 1);
  assert.equal(incidents.data[0].occurrenceCount, 2);
});

test('a genuinely different error creates a separate incident', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, { eventId: randomUUID() });
  await sendEvent(rawKey, {
    eventId: randomUUID(),
    error: { name: 'Error', message: 'Payment gateway unavailable' },
  });

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(incidents.data.length, 2);
});

test('same message but a different application stack frame creates a separate incident', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, {
    eventId: randomUUID(),
    error: { name: 'Error', message: 'boom', stack: 'Error: boom\n at f (src/services/payment.service.ts:1:1)' },
  });
  await sendEvent(rawKey, {
    eventId: randomUUID(),
    error: { name: 'Error', message: 'boom', stack: 'Error: boom\n at f (src/services/other.service.ts:1:1)' },
  });

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(incidents.data.length, 2);
});

test('resolving an incident then reopens it when a matching event arrives', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, { eventId: randomUUID() });
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id;

  const resolved = await fetch(`${server.baseUrl}/incidents/${incidentId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'RESOLVED' }),
  }).then((r) => r.json());
  assert.equal(resolved.status, 'RESOLVED');
  assert.ok(resolved.resolvedAt);

  await sendEvent(rawKey, { eventId: randomUUID() });

  const reopened = await fetch(`${server.baseUrl}/incidents/${incidentId}`).then((r) => r.json());
  assert.equal(reopened.status, 'OPEN');
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.occurrenceCount, 2);
});

test('ignoring an incident keeps it ignored on new matching events, but still counts them', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, { eventId: randomUUID() });
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id;

  await fetch(`${server.baseUrl}/incidents/${incidentId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'IGNORED' }),
  });

  await sendEvent(rawKey, { eventId: randomUUID() });

  const stillIgnored = await fetch(`${server.baseUrl}/incidents/${incidentId}`).then((r) => r.json());
  assert.equal(stillIgnored.status, 'IGNORED');
  assert.equal(stillIgnored.occurrenceCount, 2);
});

test('concurrent events with the same fingerprint create exactly one incident', async () => {
  const { rawKey, project } = await seed();

  await Promise.all(
    Array.from({ length: 5 }, () => sendEvent(rawKey, { eventId: randomUUID() })),
  );

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(incidents.data.length, 1);
  assert.equal(incidents.data[0].occurrenceCount, 5);
});

test('GET /incidents/:incidentId returns latest event and recent events', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, { eventId: randomUUID() });
  await sendEvent(rawKey, { eventId: randomUUID() });

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id;

  const detail = await fetch(`${server.baseUrl}/incidents/${incidentId}`).then((r) => r.json());
  assert.equal(detail.occurrenceCount, 2);
  assert.ok(detail.latestEvent);
  assert.equal(detail.recentEvents.length, 2);
  assert.equal(detail.fingerprint !== undefined, true);
});

test('GET /incidents/:incidentId/events paginates and sorts newest first', async () => {
  const { rawKey, project } = await seed();

  for (let i = 0; i < 3; i += 1) {
    await sendEvent(rawKey, { eventId: randomUUID() });
  }

  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id;

  const res = await fetch(`${server.baseUrl}/incidents/${incidentId}/events?limit=2`);
  const body = await res.json();
  assert.equal(body.data.length, 2);
  assert.equal(body.pagination.total, 3);
  assert.ok(new Date(body.data[0].timestamp) >= new Date(body.data[1].timestamp));
});

test('status filter defaults to OPEN and excludes resolved incidents', async () => {
  const { rawKey, project } = await seed();

  await sendEvent(rawKey, { eventId: randomUUID() });
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id;

  await fetch(`${server.baseUrl}/incidents/${incidentId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'RESOLVED' }),
  });

  const defaultList = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  assert.equal(defaultList.data.length, 0);

  const resolvedList = await fetch(`${server.baseUrl}/projects/${project.id}/incidents?status=RESOLVED`).then((r) =>
    r.json(),
  );
  assert.equal(resolvedList.data.length, 1);
});

test('rejects an invalid status transition', async () => {
  const { rawKey, project } = await seed();
  await sendEvent(rawKey, { eventId: randomUUID() });
  const incidents = await fetch(`${server.baseUrl}/projects/${project.id}/incidents`).then((r) => r.json());
  const incidentId = incidents.data[0].id;

  const res = await fetch(`${server.baseUrl}/incidents/${incidentId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'CLOSED' }),
  });
  assert.equal(res.status, 400);
});
