const express = require('express');

const app = express();
const port = process.env.PORT || 4000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/test-error', () => {
  throw new Error('Demo payment processing error');
});

app.listen(port, () => {
  console.log(`Demo app listening on http://localhost:${port}`);
});
