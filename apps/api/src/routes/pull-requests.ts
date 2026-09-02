import { Router } from 'express';
import { wrap } from '../errors';
import { startPrCreation, getPullRequest, listIncidentPullRequests, refreshPullRequest, PrCreationError } from '../pull-requests/pull-requests.service';

export const pullRequestsRouter = Router();

pullRequestsRouter.post(
  '/incidents/:incidentId/create-pr',
  wrap(async (req, res) => {
    try {
      const result = await startPrCreation(req.params.incidentId);
      res.json(result);
    } catch (err) {
      if (err instanceof PrCreationError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  }),
);

pullRequestsRouter.get(
  '/pull-requests/:id',
  wrap(async (req, res) => {
    res.json(await getPullRequest(req.params.id));
  }),
);

pullRequestsRouter.get(
  '/incidents/:incidentId/pull-requests',
  wrap(async (req, res) => {
    res.json(await listIncidentPullRequests(req.params.incidentId));
  }),
);

pullRequestsRouter.get(
  '/pull-requests/:id/refresh',
  wrap(async (req, res) => {
    res.json(await refreshPullRequest(req.params.id));
  }),
);
