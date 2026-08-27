import 'dotenv/config';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import { EnvironmentType } from '../src/generated/prisma/client';

export async function startTestServer() {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function hashApiKey(rawKey: string) {
  return createHash('sha256').update(rawKey).digest('hex');
}

/** Creates a project/environment/API key directly via Prisma (faster than round-tripping HTTP for test setup). */
export async function seedProjectWithApiKey(type: EnvironmentType = EnvironmentType.PRODUCTION) {
  const suffix = randomUUID().slice(0, 8);
  const project = await prisma.project.create({
    data: { name: `Test Project ${suffix}`, slug: `test-project-${suffix}` },
  });
  const environment = await prisma.environment.create({
    data: { projectId: project.id, name: 'Test Env', slug: `test-env-${suffix}`, type },
  });

  const rawKey = `iai_test_${randomUUID().replace(/-/g, '')}`;
  const apiKey = await prisma.apiKey.create({
    data: {
      projectId: project.id,
      environmentId: environment.id,
      name: 'Test Key',
      keyPrefix: rawKey.slice(0, 16),
      keyHash: hashApiKey(rawKey),
    },
  });

  return { project, environment, apiKey, rawKey };
}

export async function cleanupProject(projectId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
}

export function validEventBody(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    service: { name: 'payment-service', environment: 'production', release: '1.0.0' },
    error: { name: 'TypeError', message: 'Cannot read properties of undefined', stack: 'TypeError: x\n at a.js:1:1' },
    ...overrides,
  };
}
