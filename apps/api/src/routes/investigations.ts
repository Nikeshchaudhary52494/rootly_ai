import { Router } from 'express';
import { wrap } from '../errors';
import { startInvestigation, getInvestigation, listIncidentInvestigations } from '../investigations/investigations.service';

export const investigationsRouter = Router();

investigationsRouter.post(
  '/incidents/:incidentId/investigate',
  wrap(async (req, res) => {
    const result = await startInvestigation(req.params.incidentId);
    res.json(result);
  }),
);

investigationsRouter.get(
  '/investigations/:investigationId',
  wrap(async (req, res) => {
    res.json(await getInvestigation(req.params.investigationId));
  }),
);

investigationsRouter.get(
  '/incidents/:incidentId/investigations',
  wrap(async (req, res) => {
    res.json(await listIncidentInvestigations(req.params.incidentId));
  }),
);
