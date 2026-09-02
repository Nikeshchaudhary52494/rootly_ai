import { Router } from 'express';
import { wrap } from '../errors';
import { startFixAttempt, getFixAttempt, listIncidentFixAttempts, FixPreconditionError } from '../fix-attempts/fix-attempts.service';

export const fixAttemptsRouter = Router();

fixAttemptsRouter.post(
  '/incidents/:incidentId/fix',
  wrap(async (req, res) => {
    try {
      const result = await startFixAttempt(req.params.incidentId);
      res.json(result);
    } catch (err) {
      if (err instanceof FixPreconditionError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  }),
);

fixAttemptsRouter.get(
  '/fix-attempts/:id',
  wrap(async (req, res) => {
    res.json(await getFixAttempt(req.params.id));
  }),
);

fixAttemptsRouter.get(
  '/incidents/:incidentId/fix-attempts',
  wrap(async (req, res) => {
    res.json(await listIncidentFixAttempts(req.params.incidentId));
  }),
);
