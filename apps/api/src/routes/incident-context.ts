import { Router } from 'express';
import { wrap } from '../errors';
import { collectContext, getContext } from '../incident-context/incident-context.service';

export const incidentContextRouter = Router();

incidentContextRouter.post(
  '/incidents/:incidentId/context/collect',
  wrap(async (req, res) => {
    const result = await collectContext(req.params.incidentId);
    res.json({ success: true, status: result.status, contextId: result.id });
  }),
);

incidentContextRouter.get(
  '/incidents/:incidentId/context',
  wrap(async (req, res) => {
    res.json(await getContext(req.params.incidentId));
  }),
);
