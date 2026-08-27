require('dotenv/config');
const express = require('express');
const { IncidentAI } = require('@incident-ai/node');

const incidentAI = new IncidentAI({
  apiKey: process.env.INCIDENT_AI_API_KEY,
  serverUrl: process.env.INCIDENT_AI_SERVER_URL || 'http://localhost:3001',
  serviceName: 'payment-service',
  environment: 'production',
  release: '1.0.0',
  debug: true,
});

incidentAI.init();

const app = express();
const port = process.env.PORT || 4000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Intentionally async + unwrapped: Express 4 does not catch a throw/rejection
// inside an async route handler, so this becomes a genuine unhandledRejection
// for the SDK's process-level listener to capture — not an Express 500.
app.get('/test-error', async (_req, _res) => {
  const payment = undefined;
  return payment.customer.id;
});

app.get('/manual-error', (_req, res) => {
  try {
    throw new Error('Manual payment processing error');
  } catch (error) {
    incidentAI.captureException(error);
    res.status(500).json({ error: 'Error captured by Incident AI' });
  }
});

app.listen(port, () => {
  console.log(`Demo app listening on http://localhost:${port}`);
});
