# @incident-ai/node

Node.js SDK for reporting application errors to Incident AI.

```ts
import { IncidentAI } from "@incident-ai/node";

const incidentAI = new IncidentAI({
  apiKey: process.env.INCIDENT_AI_API_KEY!,
  serverUrl: "http://localhost:3001",
  serviceName: "payment-service",
  environment: "production",
  release: "1.0.0",
  debug: true,
});

incidentAI.init(); // wires up uncaughtException / unhandledRejection

incidentAI.captureException(error);
incidentAI.captureMessage("Something unexpected happened");
```

## Config

| Field | Required | Default |
|---|---|---|
| `apiKey` | yes | — |
| `serviceName` | yes | — |
| `environment` | yes | — |
| `serverUrl` | no | `http://localhost:3001` |
| `release` | no | — |
| `debug` | no | `false` |
| `enabled` | no | `true` |

## Behavior

- Never throws into the host application — capture and send are best-effort.
- `enabled: false` disables sending entirely (capture calls become no-ops).
- Delivery is send-immediately, no local queue/retry/batching yet (the `Transport`
  interface in `src/transport/http.transport.ts` is intentionally narrow so a
  future batching/retry transport can drop in without changing the public API).
- Debug logs (`debug: true`) never include the API key or Authorization header.

Build: `npm run build --workspace=@incident-ai/node`. Consumed locally via the npm
workspace; not yet published to npm.
