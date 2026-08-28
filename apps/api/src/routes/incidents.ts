import { Router } from 'express';
import { IncidentStatus } from '../generated/prisma/client';
import { badRequest, wrap } from '../errors';
import { requireString } from '../validate';
import {
  getIncidentDetail,
  listIncidents,
  listIncidentEvents,
  updateIncidentStatus,
} from '../incidents/incidents.service';

export const incidentsRouter = Router();

function parseStatus(value: unknown): IncidentStatus | undefined {
  if (value === undefined) return undefined;
  const allowed = Object.values(IncidentStatus);
  if (!allowed.includes(value as IncidentStatus)) {
    throw badRequest(`status must be one of the following values: ${allowed.join(', ')}`);
  }
  return value as IncidentStatus;
}

function parseListParams(query: Record<string, unknown>) {
  return {
    environmentId: typeof query.environmentId === 'string' ? query.environmentId : undefined,
    status: parseStatus(query.status),
    limit: query.limit !== undefined ? Number.parseInt(String(query.limit), 10) : undefined,
    offset: query.offset !== undefined ? Number.parseInt(String(query.offset), 10) : undefined,
  };
}

incidentsRouter.get(
  '/projects/:projectId/incidents',
  wrap(async (req, res) => {
    const result = await listIncidents(req.params.projectId, parseListParams(req.query as Record<string, unknown>));
    res.json(result);
  }),
);

incidentsRouter.get(
  '/incidents/:incidentId',
  wrap(async (req, res) => {
    res.json(await getIncidentDetail(req.params.incidentId));
  }),
);

incidentsRouter.get(
  '/incidents/:incidentId/events',
  wrap(async (req, res) => {
    const { limit, offset } = parseListParams(req.query as Record<string, unknown>);
    res.json(await listIncidentEvents(req.params.incidentId, { limit, offset }));
  }),
);

incidentsRouter.patch(
  '/incidents/:incidentId/status',
  wrap(async (req, res) => {
    const status = requireString(req.body, 'status');
    res.json(await updateIncidentStatus(req.params.incidentId, status));
  }),
);
