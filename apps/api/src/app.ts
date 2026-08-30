import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health';
import { projectsRouter } from './routes/projects';
import { environmentsRouter } from './routes/environments';
import { apiKeysRouter } from './routes/api-keys';
import { eventsRouter } from './routes/events';
import { incidentsRouter } from './routes/incidents';
import { repositoryRouter } from './routes/repository';
import { incidentContextRouter } from './routes/incident-context';
import { AppError, statusText } from './errors';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.use(healthRouter);
app.use(projectsRouter);
app.use(environmentsRouter);
app.use(apiKeysRouter);
app.use(eventsRouter);
app.use(incidentsRouter);
app.use(repositoryRouter);
app.use(incidentContextRouter);

app.use((req, res) => {
  res.status(404).json({ statusCode: 404, message: `Cannot ${req.method} ${req.path}` });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      statusCode: err.statusCode,
      message: err.payload,
      error: statusText(err.statusCode),
    });
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ statusCode: 400, message: 'Invalid JSON body', error: 'Bad Request' });
    return;
  }

  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
    res.status(413).json({ statusCode: 413, message: 'Payload too large', error: 'Payload Too Large' });
    return;
  }

  console.error(err);
  res.status(500).json({ statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' });
};

app.use(errorHandler);
