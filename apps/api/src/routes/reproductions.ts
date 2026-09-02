import { Router } from 'express';
import { wrap } from '../errors';
import {
  startReproduction,
  getReproductionRun,
  listIncidentReproductionRuns,
  ReproductionPreconditionError,
} from '../reproductions/reproductions.service';

export const reproductionsRouter = Router();

reproductionsRouter.post(
  '/incidents/:incidentId/reproduce',
  wrap(async (req, res) => {
    try {
      const result = await startReproduction(req.params.incidentId);
      res.json(result);
    } catch (err) {
      if (err instanceof ReproductionPreconditionError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  }),
);

reproductionsRouter.get(
  '/reproduction-runs/:id',
  wrap(async (req, res) => {
    res.json(await getReproductionRun(req.params.id));
  }),
);

reproductionsRouter.get(
  '/incidents/:incidentId/reproduction-runs',
  wrap(async (req, res) => {
    res.json(await listIncidentReproductionRuns(req.params.incidentId));
  }),
);
