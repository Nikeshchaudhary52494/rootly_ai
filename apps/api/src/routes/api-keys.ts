import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { EnvironmentType } from '../generated/prisma/client';
import { notFound, wrap } from '../errors';
import { requireString } from '../validate';

export const apiKeysRouter = Router();

const API_KEY_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  projectId: true,
  environmentId: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
};

function hashKey(rawKey: string) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateRawKey(type: EnvironmentType) {
  const segment = type === EnvironmentType.PRODUCTION ? 'live' : 'dev';
  const token = randomBytes(24).toString('base64url');
  const fullKey = `iai_${segment}_${token}`;
  const keyPrefix = fullKey.slice(0, fullKey.indexOf('_', 4) + 9);
  return { fullKey, keyPrefix };
}

apiKeysRouter.post(
  '/projects/:projectId/environments/:environmentId/api-keys',
  wrap(async (req, res) => {
    const { projectId, environmentId } = req.params;
    const name = requireString(req.body, 'name');

    const environment = await prisma.environment.findFirst({
      where: { id: environmentId, projectId },
    });
    if (!environment) throw notFound('Environment not found');

    const { fullKey, keyPrefix } = generateRawKey(environment.type);
    const keyHash = hashKey(fullKey);

    const apiKey = await prisma.apiKey.create({
      data: { projectId, environmentId, name, keyPrefix, keyHash },
      select: API_KEY_SELECT,
    });

    res.status(201).json({
      ...apiKey,
      apiKey: fullKey,
      message: 'Save this API key now. It will not be displayed again.',
    });
  }),
);

apiKeysRouter.get(
  '/projects/:projectId/environments/:environmentId/api-keys',
  wrap(async (req, res) => {
    const { projectId, environmentId } = req.params;

    const environment = await prisma.environment.findFirst({
      where: { id: environmentId, projectId },
    });
    if (!environment) throw notFound('Environment not found');

    const apiKeys = await prisma.apiKey.findMany({
      where: { projectId, environmentId },
      orderBy: { createdAt: 'desc' },
      select: API_KEY_SELECT,
    });
    res.json(apiKeys);
  }),
);

apiKeysRouter.post(
  '/api-keys/validate',
  wrap(async (req, res) => {
    const rawKey = requireString(req.body, 'apiKey');
    const keyHash = hashKey(rawKey);
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

    if (!apiKey || apiKey.revokedAt) {
      res.json({ valid: false });
      return;
    }

    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    res.json({ valid: true, projectId: apiKey.projectId, environmentId: apiKey.environmentId });
  }),
);

apiKeysRouter.get(
  '/api-keys/:apiKeyId',
  wrap(async (req, res) => {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: req.params.apiKeyId },
      select: API_KEY_SELECT,
    });
    if (!apiKey) throw notFound('API key not found');
    res.json(apiKey);
  }),
);

apiKeysRouter.post(
  '/api-keys/:apiKeyId/revoke',
  wrap(async (req, res) => {
    const existing = await prisma.apiKey.findUnique({ where: { id: req.params.apiKeyId } });
    if (!existing) throw notFound('API key not found');

    const apiKey = await prisma.apiKey.update({
      where: { id: req.params.apiKeyId },
      data: { revokedAt: new Date() },
      select: API_KEY_SELECT,
    });
    res.json(apiKey);
  }),
);
