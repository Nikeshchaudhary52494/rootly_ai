import { Router } from 'express';
import { prisma } from '../prisma';
import { Prisma } from '../generated/prisma/client';
import { apiKeyAuth } from '../middleware/api-key-auth';
import { badRequest, notFound, wrap } from '../errors';
import { generateFingerprint } from '../incidents/utils/fingerprint';
import { recordIncidentForEvent } from '../incidents/incidents.service';

export const eventsRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITS = {
  serviceName: 100,
  errorName: 200,
  errorMessage: 5000,
  stackTrace: 50000,
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

interface ParsedEvent {
  eventId: string;
  timestamp: Date;
  serviceName: string;
  environmentName: string;
  release?: string;
  errorName: string;
  errorMessage: string;
  stackTrace?: string;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required`);
  }
  if (value.length > maxLength) {
    throw badRequest(`${field} must not exceed ${maxLength} characters`);
  }
  return value;
}

function optionalStringField(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string`);
  }
  if (value.length > maxLength) {
    throw badRequest(`${field} must not exceed ${maxLength} characters`);
  }
  return value;
}

function parseEventPayload(body: unknown): ParsedEvent {
  const payload = (body ?? {}) as Record<string, unknown>;

  const eventIdRaw = payload.eventId;
  if (typeof eventIdRaw !== 'string' || !UUID_PATTERN.test(eventIdRaw)) {
    throw badRequest('eventId must be a valid UUID');
  }

  const timestampRaw = payload.timestamp;
  const timestamp = typeof timestampRaw === 'string' ? new Date(timestampRaw) : new Date(NaN);
  if (typeof timestampRaw !== 'string' || Number.isNaN(timestamp.getTime())) {
    throw badRequest('timestamp must be a valid ISO 8601 date');
  }

  const service = (payload.service ?? {}) as Record<string, unknown>;
  const serviceName = requiredString(service.name, 'service.name', LIMITS.serviceName);
  const environmentName = requiredString(service.environment, 'service.environment', LIMITS.serviceName);
  const release = optionalStringField(service.release, 'service.release', LIMITS.serviceName);

  const error = (payload.error ?? {}) as Record<string, unknown>;
  const errorName = requiredString(error.name, 'error.name', LIMITS.errorName);
  const errorMessage = requiredString(error.message, 'error.message', LIMITS.errorMessage);
  const stackTrace = optionalStringField(error.stack, 'error.stack', LIMITS.stackTrace);

  return { eventId: eventIdRaw, timestamp, serviceName, environmentName, release, errorName, errorMessage, stackTrace };
}

eventsRouter.post(
  '/events',
  apiKeyAuth,
  wrap(async (req, res) => {
    const { projectId, environmentId, apiKeyId } = req.incidentApiKey!;
    const parsed = parseEventPayload(req.body);

    const fingerprint = generateFingerprint(parsed.errorName, parsed.errorMessage, parsed.stackTrace);

    try {
      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.errorEvent.create({
          data: {
            projectId,
            environmentId,
            apiKeyId,
            eventId: parsed.eventId,
            serviceName: parsed.serviceName,
            environmentName: parsed.environmentName,
            release: parsed.release,
            errorName: parsed.errorName,
            errorMessage: parsed.errorMessage,
            stackTrace: parsed.stackTrace,
            fingerprint,
            timestamp: parsed.timestamp,
          },
        });

        const incidentId = await recordIncidentForEvent(tx, {
          projectId,
          environmentId,
          errorName: parsed.errorName,
          errorMessage: parsed.errorMessage,
          stackTrace: parsed.stackTrace,
          timestamp: parsed.timestamp,
          eventId: created.id,
        });

        return tx.errorEvent.update({ where: { id: created.id }, data: { incidentId } });
      });
      res.status(201).json({ success: true, eventId: event.eventId });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        res.status(200).json({ success: true, eventId: parsed.eventId, duplicate: true });
        return;
      }
      throw err;
    }
  }),
);

eventsRouter.get(
  '/projects/:projectId/events',
  wrap(async (req, res) => {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project not found');

    const environmentId = typeof req.query.environmentId === 'string' ? req.query.environmentId : undefined;
    const limit = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, Number.parseInt(String(req.query.limit ?? DEFAULT_LIST_LIMIT), 10) || DEFAULT_LIST_LIMIT),
    );
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? 0), 10) || 0);

    const where = { projectId, ...(environmentId ? { environmentId } : {}) };

    const [data, total] = await Promise.all([
      prisma.errorEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          eventId: true,
          projectId: true,
          environmentId: true,
          serviceName: true,
          environmentName: true,
          release: true,
          errorName: true,
          errorMessage: true,
          timestamp: true,
          receivedAt: true,
          incident: { select: { id: true, sequenceNumber: true, status: true } },
        },
      }),
      prisma.errorEvent.count({ where }),
    ]);

    res.json({ data, pagination: { total, limit, offset } });
  }),
);

eventsRouter.get(
  '/events/:eventId',
  wrap(async (req, res) => {
    const event = await prisma.errorEvent.findUnique({
      where: { id: req.params.eventId },
      include: { incident: { select: { id: true, sequenceNumber: true, status: true } } },
    });
    if (!event) throw notFound('Event not found');
    res.json(event);
  }),
);
