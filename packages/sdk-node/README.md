# @rootly.ai/node

Node.js SDK for reporting application errors to rootly.ai.

```ts
import { RootlyAI } from "@rootly.ai/node";

const rootlyAI = new RootlyAI({
  apiKey: process.env.ROOTLY_AI_API_KEY!,
  serverUrl: "http://localhost:3001",
  serviceName: "payment-service",
  environment: "production",
  release: "1.0.0",
  debug: true,
});

rootlyAI.init(); // wires up uncaughtException / unhandledRejection

rootlyAI.captureException(error);
rootlyAI.captureMessage("Something unexpected happened");
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

Build: `npm run build --workspace=@rootly.ai/node`. Consumed locally via the npm
workspace; not yet published to npm.
