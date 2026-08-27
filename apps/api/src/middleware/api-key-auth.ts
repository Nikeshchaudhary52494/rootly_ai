import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma';
import { unauthorized } from '../errors';
import { hashApiKey } from '../api-key-hash';

export interface AuthenticatedApiKey {
  apiKeyId: string;
  projectId: string;
  environmentId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    incidentApiKey?: AuthenticatedApiKey;
  }
}

export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(unauthorized('Missing or invalid Authorization header'));
    return;
  }

  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });

  if (!apiKey || apiKey.revokedAt) {
    next(unauthorized('Invalid or revoked API key'));
    return;
  }

  req.incidentApiKey = {
    apiKeyId: apiKey.id,
    projectId: apiKey.projectId,
    environmentId: apiKey.environmentId,
  };

  // Best-effort — must not block or fail the ingestion request.
  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  next();
}
