# Incident AI

AI-powered incident response platform.

- **Phase 1: Foundation** — project/environment management, API key generation, dashboard/API/database scaffolding.
- **Phase 2: Node SDK + error event ingestion** — a real `@incident-ai/node` SDK, an authenticated `POST /events` ingestion endpoint, idempotent storage, and a dashboard view of captured errors.

Later phases (incident grouping, AI investigation, GitHub PRs) build on this.

## Stack

- **Dashboard**: Next.js (App Router) + TypeScript + Tailwind
- **API**: Express + TypeScript (routers per resource, Prisma via a driver adapter, no framework layer beyond Express itself)
- **Database**: PostgreSQL + Prisma 7 (`@prisma/adapter-pg`, `prisma.config.ts`)
- **Infra**: Docker Compose (Postgres only — dashboard/API/demo app run via npm)

## Repository structure

```
incident-ai/
├── apps/
│   ├── dashboard/       Next.js dashboard
│   │   └── src/app/
│   │       ├── projects/[projectId]/events/      Error event list for a project
│   │       └── events/[eventId]/                 Error event detail (stack trace, copy)
│   └── api/             Express API
│       ├── test/             Integration tests (node:test, real Postgres)
│       └── src/
│           ├── routes/          health, projects, environments, api-keys, events
│           ├── middleware/
│           │   └── api-key-auth.ts   Bearer-token auth: resolves API key → project/environment
│           ├── prisma.ts        Prisma client singleton (adapter-pg)
│           ├── api-key-hash.ts  Shared sha256 hashing (used by api-keys + auth middleware)
│           ├── errors.ts        AppError + centralized error-handling middleware
│           ├── validate.ts      Small manual request-validation helpers
│           ├── app.ts           Express app assembly (cors, json, routers, error handler)
│           └── main.ts          Entrypoint / listen / graceful shutdown
├── packages/
│   ├── shared/           Shared TypeScript types used by the dashboard
│   └── sdk-node/         @incident-ai/node — the Node.js error-reporting SDK
│       ├── test/              SDK unit tests (node:test, mocked fetch)
│       └── src/
│           ├── incident-ai.ts       Public IncidentAI class (init/captureException/captureMessage)
│           ├── client.ts            Wires config → transport, respects enabled/disabled
│           ├── capture/error.capture.ts   Builds the wire payload (eventId, timestamp, ...)
│           ├── transport/http.transport.ts   fetch-based POST /events, 5s timeout, never throws
│           └── utils/                error-normalizer.ts, logger.ts
├── demo-app/             Express app wired to the SDK — /health, /test-error, /manual-error
├── docker-compose.yml    Local Postgres
└── .env.example
```

## Running locally

1. **Start Postgres**

   ```bash
   docker compose up -d
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   cp .env.example apps/api/.env
   ```

   (Postgres in this repo is mapped to host port **5433**, not 5432, to avoid
   clashing with a locally installed Postgres — see `DATABASE_URL` in `.env.example`.)

3. **Install dependencies** (from the repo root — npm workspaces)

   ```bash
   npm install
   ```

4. **Run the initial migration** (first time only)

   ```bash
   npm run prisma:migrate --workspace=api
   ```

5. **Start the API**

   ```bash
   npm run dev:api
   # http://localhost:3001
   ```

6. **Start the dashboard**

   ```bash
   npm run dev:dashboard
   # http://localhost:3000
   ```

7. **Build the SDK** (the demo app requires the compiled `dist/`, which is gitignored)

   ```bash
   npm run build:sdk
   ```

8. **Wire an API key into the demo app**

   Generate a project/environment/API key from the dashboard (or via `curl`), then:

   ```bash
   cp demo-app/.env.example demo-app/.env
   # edit demo-app/.env and set INCIDENT_AI_API_KEY to the raw key
   ```

9. **Start the demo app**

   ```bash
   npm run dev:demo
   # http://localhost:4000
   ```

   - `GET /manual-error` — caught in a try/catch, reported via `captureException`.
   - `GET /test-error` — an **async** handler that throws without being caught by
     Express 4 (which doesn't catch rejections from async route handlers), so it
     becomes a real `unhandledRejection` for the SDK to capture automatically. This
     request will hang/time out client-side (no response is ever sent) — that's
     expected; check the demo app's logs and the dashboard instead of the HTTP response.

## Database models

- **Project** — `id`, `name`, `slug` (unique), `description?`, timestamps
- **Environment** — belongs to a Project; `name`, `slug` (unique per project), `type` (`DEVELOPMENT` | `STAGING` | `PRODUCTION`)
- **ApiKey** — belongs to a Project + Environment; stores `keyPrefix` + `keyHash` only, never the raw key; supports revocation (`revokedAt`) and tracks `lastUsedAt`
- **ErrorEvent** — belongs to a Project + Environment + ApiKey; `eventId` is unique (SDK-generated, enforces idempotency); `serviceName`/`environmentName`/`release` as reported by the SDK; `errorName`/`errorMessage`/`stackTrace?`; `timestamp` (when the error happened) vs `receivedAt` (when the API got it); indexed on `projectId`, `environmentId`, `timestamp`, `receivedAt`, `errorName`

## API endpoints

```
GET    /health

POST   /projects
GET    /projects
GET    /projects/:projectId
PATCH  /projects/:projectId
DELETE /projects/:projectId

POST   /projects/:projectId/environments
GET    /projects/:projectId/environments
GET    /projects/:projectId/environments/:environmentId
PATCH  /projects/:projectId/environments/:environmentId
DELETE /projects/:projectId/environments/:environmentId

POST   /projects/:projectId/environments/:environmentId/api-keys
GET    /projects/:projectId/environments/:environmentId/api-keys
GET    /api-keys/:apiKeyId
POST   /api-keys/:apiKeyId/revoke
POST   /api-keys/validate

POST   /events                              (Bearer <api-key>; SDK ingestion)
GET    /projects/:projectId/events           ?environmentId=&limit=&offset=
GET    /events/:eventId
```

API keys are formatted `iai_live_...` (PRODUCTION environments) or
`iai_dev_...` (DEVELOPMENT/STAGING). The raw key is returned exactly once,
on creation — every other response (`GET`, list) returns only `keyPrefix`.

### Event ingestion (`POST /events`)

Authenticated with `Authorization: Bearer <api-key>` — the same key system as
Phase 1, resolved by `src/middleware/api-key-auth.ts`. The project/environment
a captured error is filed under comes **only** from the API key; any
`projectId`/`environmentId`/`apiKeyId` in the request body is ignored.

```
POST /events
Authorization: Bearer iai_live_xxxxx
Content-Type: application/json

{
  "eventId": "<uuid, SDK-generated>",
  "timestamp": "2026-08-28T10:00:00.000Z",
  "service": { "name": "payment-service", "environment": "production", "release": "1.0.0" },
  "error": { "name": "TypeError", "message": "...", "stack": "..." }
}
```

- `eventId` must be a UUID; `timestamp` must be a valid ISO date; `service.name`/`service.environment`/`error.name`/`error.message` are required; `error.stack`/`service.release` are optional.
- Field limits: `service.name` ≤100, `error.name` ≤200, `error.message` ≤5000, `error.stack` ≤50000 chars (413 for an oversized request body, 400 for a field over its limit).
- **Idempotent**: the same `eventId` sent twice returns `{"success":true,"eventId":"...","duplicate":true}` the second time — enforced by a DB unique constraint (`prisma.errorEvent.create` → catch `P2002`), so it's correct under real concurrent duplicate requests, not just sequential ones.
- 401 for a missing/invalid/revoked API key. API key `lastUsedAt` is updated best-effort (fire-and-forget; a failure there never fails the ingestion request).

## SDK (`@incident-ai/node`)

```ts
import { IncidentAI } from "@incident-ai/node";

const incidentAI = new IncidentAI({
  apiKey: process.env.INCIDENT_AI_API_KEY!,
  serverUrl: "http://localhost:3001",  // default
  serviceName: "payment-service",
  environment: "production",
  release: "1.0.0",
  debug: true,
});

incidentAI.init();                          // wires uncaughtException / unhandledRejection
incidentAI.captureException(error);          // manual capture
incidentAI.captureMessage("Something odd");  // manual, non-exception message
```

- Never throws into the host app; a failed send is swallowed (debug-logged only if `debug: true`).
- `enabled: false` makes every capture call a no-op — no event is ever sent.
- Delivery is fire-and-forget over `fetch`, 5s timeout, no queue/retry/batching yet — the
  `Transport` interface (`src/transport/http.transport.ts`) is deliberately narrow so a
  future batching/retry transport can implement it without an API change.
- Debug logs never include the API key or `Authorization` header (verified by a test).
- Not published to npm — consumed via the npm workspace (`@incident-ai/node`); build
  with `npm run build:sdk` before running the demo app or anything else that imports it.

## Testing

```bash
npm run test:sdk   # packages/sdk-node — node:test, mocked fetch, no network/DB needed
npm run test:api   # apps/api — node:test, integration tests against the real dev Postgres
```

Both use Node's built-in test runner (via `tsx`) — no Jest/Vitest dependency. The API
tests seed their own projects/environments/API keys directly through Prisma, exercise
the real Express app on an ephemeral port, and clean up what they created afterward.
They require Postgres to be running (`docker compose up -d`).

## Known limitations (Phase 2 scope)

- No auth/accounts — anyone with dashboard access can manage all projects.
- No incident grouping/fingerprinting, AI investigation, or GitHub integration (Phase 3+).
- No pagination UI in the dashboard yet (the API supports `limit`/`offset`).
- Dashboard fetches client-side per page; no caching/optimistic UI beyond the basics.
- SDK delivery is send-immediately with no local queue — an app that crashes before the
  `fetch` resolves can lose that one event (acceptable for Phase 2's scope; explicitly
  deferred per the phase spec).
- The API started on NestJS; it was rewritten to plain Express because the NestJS 12
  upgrade needed to clear its remaining `npm audit` findings is currently blocked
  upstream — TypeScript never shipped a stable 6.x, and TypeScript 7.0 (the current
  `latest`) dropped the compiler API the Nest CLI depends on (due back in 7.1). The
  Express rewrite carries **0 known vulnerabilities** and the same routes/behavior.
