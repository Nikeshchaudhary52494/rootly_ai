# Incident AI

AI-powered incident response platform. **Phase 1: Foundation** — project/environment
management, API key generation, and the dashboard/API/database scaffolding that
later phases (SDK event ingestion, incident detection, AI investigation, GitHub PRs)
will build on.

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
│   └── api/             Express API (projects, environments, api-keys, health)
│       └── src/
│           ├── routes/       One router per resource (health, projects, environments, api-keys)
│           ├── prisma.ts     Prisma client singleton (adapter-pg)
│           ├── errors.ts     AppError + centralized error-handling middleware
│           ├── validate.ts   Small manual request-validation helpers
│           ├── app.ts        Express app assembly (cors, json, routers, error handler)
│           └── main.ts       Entrypoint / listen / graceful shutdown
├── packages/
│   ├── shared/           Shared TypeScript types used by the dashboard
│   └── sdk-node/         Placeholder — Node SDK ships in Phase 2
├── demo-app/             Minimal Express app with /health and /test-error
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

7. **(Optional) Start the demo app**

   ```bash
   npm run dev:demo
   # http://localhost:4000
   ```

## Database models

- **Project** — `id`, `name`, `slug` (unique), `description?`, timestamps
- **Environment** — belongs to a Project; `name`, `slug` (unique per project), `type` (`DEVELOPMENT` | `STAGING` | `PRODUCTION`)
- **ApiKey** — belongs to a Project + Environment; stores `keyPrefix` + `keyHash` only, never the raw key; supports revocation (`revokedAt`) and tracks `lastUsedAt`

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
```

API keys are formatted `iai_live_...` (PRODUCTION environments) or
`iai_dev_...` (DEVELOPMENT/STAGING). The raw key is returned exactly once,
on creation — every other response (`GET`, list) returns only `keyPrefix`.

## Known limitations (Phase 1 scope)

- No auth/accounts — anyone with dashboard access can manage all projects.
- No SDK event ingestion, incident detection, AI investigation, or GitHub integration (Phase 2+).
- No pagination on list endpoints (fine at MVP scale).
- Dashboard fetches client-side per page; no caching/optimistic UI beyond the basics.
- The API started on NestJS; it was rewritten to plain Express because the NestJS 12
  upgrade needed to clear its remaining `npm audit` findings is currently blocked
  upstream — TypeScript never shipped a stable 6.x, and TypeScript 7.0 (the current
  `latest`) dropped the compiler API the Nest CLI depends on (due back in 7.1). The
  Express rewrite carries **0 known vulnerabilities** and the same routes/behavior.
