import { prisma } from '../prisma';
import { IncidentStatus, Prisma } from '../generated/prisma/client';
import { notFound, badRequest } from '../errors';
import { generateFingerprint, generateIncidentTitle } from './utils/fingerprint';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

interface RecordEventInput {
  projectId: string;
  environmentId: string;
  errorName: string;
  errorMessage: string;
  stackTrace?: string;
  timestamp: Date;
  eventId: string; // ErrorEvent.id
}

/**
 * Groups an ErrorEvent into its Incident. Uses a raw INSERT ... ON CONFLICT
 * upsert so concurrent events for the same fingerprint can never create two
 * incidents (the unique constraint is enforced by Postgres, not app code).
 * Reopens a RESOLVED incident; leaves an IGNORED one alone but still counts it.
 */
export async function recordIncidentForEvent(
  tx: Prisma.TransactionClient,
  input: RecordEventInput,
): Promise<string> {
  const fingerprint = generateFingerprint(input.errorName, input.errorMessage, input.stackTrace);
  const title = generateIncidentTitle(input.errorName, input.errorMessage);

  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Incident" (
      "id", "projectId", "environmentId", "fingerprint", "title", "errorName", "errorMessage",
      "status", "occurrenceCount", "firstSeenAt", "lastSeenAt", "latestEventId", "resolvedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      gen_random_uuid(), ${input.projectId}, ${input.environmentId}, ${fingerprint}, ${title},
      ${input.errorName}, ${input.errorMessage}, 'OPEN', 1, ${input.timestamp}, ${input.timestamp},
      ${input.eventId}, NULL, now(), now()
    )
    ON CONFLICT ("projectId", "environmentId", "fingerprint")
    DO UPDATE SET
      "occurrenceCount" = "Incident"."occurrenceCount" + 1,
      "lastSeenAt" = EXCLUDED."lastSeenAt",
      "latestEventId" = EXCLUDED."latestEventId",
      "status" = CASE WHEN "Incident"."status" = 'RESOLVED' THEN 'OPEN' ELSE "Incident"."status" END,
      "resolvedAt" = CASE WHEN "Incident"."status" = 'RESOLVED' THEN NULL ELSE "Incident"."resolvedAt" END,
      "updatedAt" = now()
    RETURNING "id"
  `;

  return rows[0].id;
}

const INCIDENT_LIST_SELECT = {
  id: true,
  sequenceNumber: true,
  title: true,
  errorName: true,
  errorMessage: true,
  status: true,
  occurrenceCount: true,
  firstSeenAt: true,
  lastSeenAt: true,
  environment: { select: { id: true, name: true } },
} satisfies Prisma.IncidentSelect;

export async function listIncidents(
  projectId: string,
  params: { environmentId?: string; status?: IncidentStatus; limit?: number; offset?: number },
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project not found');

  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIST_LIMIT));
  const offset = Math.max(0, params.offset ?? 0);
  const status = params.status ?? IncidentStatus.OPEN;

  const where: Prisma.IncidentWhereInput = {
    projectId,
    status,
    ...(params.environmentId ? { environmentId: params.environmentId } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.incident.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
      skip: offset,
      select: INCIDENT_LIST_SELECT,
    }),
    prisma.incident.count({ where }),
  ]);

  return { data, pagination: { total, limit, offset } };
}

async function findIncidentOrThrow(incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { environment: { select: { id: true, name: true } } },
  });
  if (!incident) throw notFound('Incident not found');
  return incident;
}

const RECENT_EVENTS_LIMIT = 10;

export async function getIncidentDetail(incidentId: string) {
  const incident = await findIncidentOrThrow(incidentId);

  const [latestEvent, recentEvents] = await Promise.all([
    prisma.errorEvent.findUnique({ where: { id: incident.latestEventId } }),
    prisma.errorEvent.findMany({
      where: { incidentId },
      orderBy: { timestamp: 'desc' },
      take: RECENT_EVENTS_LIMIT,
    }),
  ]);

  return { ...incident, latestEvent, recentEvents };
}

export async function listIncidentEvents(
  incidentId: string,
  params: { limit?: number; offset?: number },
) {
  await findIncidentOrThrow(incidentId);

  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIST_LIMIT));
  const offset = Math.max(0, params.offset ?? 0);

  const where = { incidentId };
  const [data, total] = await Promise.all([
    prisma.errorEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.errorEvent.count({ where }),
  ]);

  return { data, pagination: { total, limit, offset } };
}

const ALLOWED_STATUSES = new Set<string>(Object.values(IncidentStatus));

export async function updateIncidentStatus(incidentId: string, status: string) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw badRequest(`status must be one of the following values: ${[...ALLOWED_STATUSES].join(', ')}`);
  }
  await findIncidentOrThrow(incidentId);

  return prisma.incident.update({
    where: { id: incidentId },
    data: {
      status: status as IncidentStatus,
      resolvedAt: status === IncidentStatus.RESOLVED ? new Date() : null,
    },
  });
}
