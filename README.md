# rootly.ai

An AI-powered production incident response platform that closes the entire
loop, end to end, with a human as the only thing that can put code into
production:

```
Application
  → Node.js SDK
  → Error Event
  → Incident Grouping
  → GitHub Code Context
  → LangGraph Investigation
  → Root Cause Analysis
  → AI Reproduction Test
  → Docker Sandbox
  → REPRODUCED
  → AI Fix Generation
  → Fresh Docker Sandbox
  → Patch Application
  → Post-Fix Validation
  → Regression Tests
  → FIX VERIFIED
  → GitHub Branch
  → Commit
  → Pull Request
  → Human Review
```

Given a real production error, rootly.ai groups it into an incident, finds
the relevant source code, investigates the root cause with an agentic
LangGraph workflow, generates a test that **actually reproduces the bug
inside an isolated Docker sandbox**, generates a candidate fix, **actually
validates that fix** by applying it to a fresh checkout and re-running tests
in another sandbox, and — only once a fix is genuinely verified — pushes a
real branch, commit, and GitHub pull request for a human to review. It never
merges, deploys, or bypasses review on its own.

## Phases

| Phase | What it added |
|---|---|
| 1 | Project/environment management, API keys, dashboard/API/database scaffolding |
| 2 | `@rootly.ai/node` SDK, authenticated `POST /events` ingestion, idempotent storage |
| 3 | Deterministic incident fingerprinting/grouping, incident status lifecycle |
| 4 | GitHub repository integration (encrypted PAT), stack-trace-to-source matching, code context |
| 5 | LangGraph AI investigation agent — ranked root-cause hypotheses with grounded evidence |
| 6 | AI-generated reproduction test, **actually executed** in an isolated Docker sandbox |
| 7 | AI-generated fix, **actually validated** in a fresh Docker sandbox (before/after + regression) |
| 8 | GitHub branch, commit, and pull request for a verified fix — human review required |

Phases 3–8 each have their own package with a dedicated README covering
architecture and security model in depth:
[`packages/reproduction`](packages/reproduction/README.md),
[`packages/fix-engine`](packages/fix-engine/README.md),
[`packages/github`](packages/github/README.md).

## Stack

- **Dashboard**: Next.js (App Router) + TypeScript + Tailwind
- **API**: Express + TypeScript (routers per resource, Prisma via a driver adapter, no framework layer beyond Express itself)
- **Database**: PostgreSQL + Prisma 7 (`@prisma/adapter-pg`, `prisma.config.ts`)
- **AI**: OpenAI (structured output via Zod schemas) orchestrated with LangGraph (`@langchain/langgraph`) for the multi-stage investigation and fix-generation graphs
- **Sandboxing**: Docker — network-disabled, no host mounts, resource-capped, ephemeral containers for reproducing bugs and validating fixes
- **GitHub**: Octokit (`@octokit/rest`) for repository reads and PR automation; `git` subprocesses (never a shell string) for clone/checkout/commit/push
- **Infra**: Docker Compose (Postgres) + a purpose-built sandbox image (`packages/reproduction/docker/sandbox.Dockerfile`)

## Repository structure

```
rootly.ai/
├── apps/
│   ├── dashboard/        Next.js dashboard
│   │   └── src/app/
│   │       ├── projects/[projectId]/...          Project/env/API key/repository/incidents/events
│   │       ├── incidents/[incidentId]/            Overview+timeline, Events, Code Context,
│   │       │                                      AI Investigation, Reproduction, Fix, Pull Request tabs
│   │       └── events/[eventId]/                  Error event detail
│   └── api/               Express API
│       ├── test/               Integration tests (node:test, real Postgres, real Docker for
│       │                       reproduction/fix/PR-promotion tests, GitHub REST mocked via nock)
│       └── src/
│           ├── routes/                health, projects, environments, api-keys, events,
│           │                          incidents, repository, incident-context, investigations,
│           │                          reproductions, fix-attempts, pull-requests
│           ├── github/                 Phase 4 GitHub read service (repo/tree/content/commits),
│           │                           token encryption, stack-trace parsing, source matching
│           ├── incidents/              fingerprinting, grouping, status lifecycle
│           ├── incident-context/       code context collection orchestration
│           ├── investigations/         wires @rootly.ai/agent to Prisma
│           ├── reproductions/          wires @rootly.ai/reproduction to Prisma
│           ├── fix-attempts/           wires @rootly.ai/fix-engine to Prisma
│           ├── pull-requests/          wires @rootly.ai/github to Prisma
│           ├── middleware/             api-key-auth.ts
│           ├── prisma.ts, errors.ts, validate.ts, app.ts, main.ts
├── packages/
│   ├── shared/            Shared TypeScript types used by the dashboard
│   ├── sdk-node/           @rootly.ai/node — the Node.js error-reporting SDK
│   ├── agent/              @rootly.ai/agent — Phase 5 LangGraph investigation agent
│   │   └── src/
│   │       ├── graph/          UNDERSTAND_ERROR -> ANALYZE_CODE -> ANALYZE_HISTORY ->
│   │       │                   GENERATE_HYPOTHESES -> EVALUATE_EVIDENCE -> GENERATE_REPORT
│   │       ├── llm/            structured-output validation + one-retry-then-fail, OpenAI client
│   │       ├── tools/          read-only context/file/repo-search/git-history tools
│   │       └── schemas/        Zod schemas for every LLM-generated document
│   ├── reproduction/       @rootly.ai/reproduction — Phase 6 reproduction sandbox (see its README)
│   ├── fix-engine/         @rootly.ai/fix-engine — Phase 7 fix generation + validation (see its README)
│   └── github/             @rootly.ai/github — Phase 8 GitHub PR automation (see its README)
├── demo-app/               Express app wired to the SDK, with a real reproducible bug
│   ├── index.js                 /health, /manual-error, /test-error, /test-dynamic-error, /test-different-error
│   └── src/services/            payment.service.js — the bug Phases 3-8's demo flow revolves around
├── docker-compose.yml      Local Postgres
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

   Fill in, at minimum:
   - `GITHUB_TOKEN_ENCRYPTION_KEY` — any random secret; encrypts stored GitHub PATs at rest (AES-256-GCM)
   - `OPENAI_API_KEY` — required for the investigation agent (Phase 5) and fix generation (Phase 7) to run for real

   (Postgres in this repo is mapped to host port **5433**, not 5432, to avoid
   clashing with a locally installed Postgres — see `DATABASE_URL` in `.env.example`.)

3. **Install dependencies** (from the repo root — npm workspaces)

   ```bash
   npm install
   ```

4. **Run migrations** (first time only)

   ```bash
   npm run prisma:migrate --workspace=api
   ```

5. **Build the workspace packages** (`apps/api` consumes their compiled `dist/`, not source)

   ```bash
   npm run build:sdk
   npm run build:agent
   npm run build:reproduction
   npm run build:fix-engine
   npm run build:github
   ```

6. **Build the reproduction/fix sandbox image** (required for Phases 6-7; Phase 8 reuses it implicitly through Phase 7's already-verified result)

   ```bash
   docker build -t rootly.ai-reproduction-sandbox \
     -f packages/reproduction/docker/sandbox.Dockerfile \
     packages/reproduction/docker
   ```

7. **Start the API**

   ```bash
   npm run dev:api
   # http://localhost:3001
   ```

8. **Start the dashboard**

   ```bash
   npm run dev:dashboard
   # http://localhost:3000
   ```

9. **Wire an API key into the demo app**

   Generate a project/environment/API key from the dashboard (or via `curl`), then:

   ```bash
   cp demo-app/.env.example demo-app/.env
   # edit demo-app/.env and set ROOTLY_AI_API_KEY to the raw key
   ```

10. **Start the demo app**

    ```bash
    npm run dev:demo
    # http://localhost:4000
    ```

    - `GET /test-error` — triggers the real bug in `demo-app/src/services/payment.service.js`
      (`confirmPayment` crashing on a payment with no `customer`) as a genuine
      `unhandledRejection`, captured automatically by the SDK. This is the error the
      full demo flow below investigates, reproduces, fixes, and opens a PR for.
    - `GET /manual-error`, `/test-dynamic-error/:userId`, `/test-different-error` — additional
      capture paths used to exercise manual capture and incident grouping/separation.

11. **Connect a GitHub repository** (dashboard → a project → Repository) with a PAT that has
    `repo` scope on a repository you're allowed to push branches to — Phases 4-8 all depend
    on this. The demo flow above is written against this project's own repository.

## Database models

- **Project / Environment / ApiKey** *(Phase 1)* — org structure; API keys store only `keyPrefix`+`keyHash`, never the raw key
- **ErrorEvent** *(Phase 2)* — one row per captured error; `eventId` unique for idempotent ingestion
- **Incident** *(Phase 3)* — deduplicated group of ErrorEvents sharing a deterministic fingerprint (error name + normalized message + top stack frames, SHA-256); `status` (`OPEN`/`RESOLVED`/`IGNORED`) with reopen semantics
- **Repository / RepositoryFile** *(Phase 4)* — one connected GitHub repo per project; encrypted PAT; synced file tree
- **IncidentCodeContext / IncidentCodeFile / IncidentCodeCommit** *(Phase 4)* — stack-trace-matched source windows, related tests, recent commit history for an incident
- **Investigation / InvestigationHypothesis / InvestigationEvidence** *(Phase 5)* — the AI investigation's state machine, ranked root-cause hypotheses, and grounded supporting/contradicting evidence
- **ReproductionRun / ReproductionTest** *(Phase 6)* — the AI-generated reproduction test and its real, deterministic classification (`REPRODUCED`/`NOT_REPRODUCED`/`INCONCLUSIVE`)
- **FixAttempt / FixPatch** *(Phase 7)* — the AI-proposed patch, its per-file before/after content and diff, `validatedPatchHash` (the Phase 7→8 integrity boundary), and the deterministic classification (`FIX_VERIFIED`/`FIX_REJECTED`/`INCONCLUSIVE`)
- **PullRequest** *(Phase 8)* — the promoted branch/commit/PR for a `FIX_VERIFIED` attempt; `status` (`CREATING`/`OPEN`/`CLOSED`/`MERGED`/`FAILED`) reflects real GitHub state, never a merge this system performed

## API endpoints

```
GET    /health

# Phase 1 — projects, environments, API keys
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

# Phase 2 — event ingestion
POST   /events                                    (Bearer <api-key>; SDK ingestion)
GET    /projects/:projectId/events                 ?environmentId=&limit=&offset=
GET    /events/:eventId

# Phase 3 — incidents
GET    /projects/:projectId/incidents               ?environmentId=&status=&limit=&offset=
GET    /incidents/:incidentId
GET    /incidents/:incidentId/events
PATCH  /incidents/:incidentId/status

# Phase 4 — GitHub repository + code context
POST   /projects/:projectId/repository
GET    /projects/:projectId/repository
DELETE /projects/:projectId/repository
POST   /projects/:projectId/repository/sync
POST   /incidents/:incidentId/context/collect
GET    /incidents/:incidentId/context

# Phase 5 — AI investigation
POST   /incidents/:incidentId/investigate
GET    /investigations/:investigationId
GET    /incidents/:incidentId/investigations

# Phase 6 — reproduction sandbox
POST   /incidents/:incidentId/reproduce
GET    /reproduction-runs/:id
GET    /incidents/:incidentId/reproduction-runs

# Phase 7 — AI fix generation + validation
POST   /incidents/:incidentId/fix
GET    /fix-attempts/:id
GET    /incidents/:incidentId/fix-attempts

# Phase 8 — GitHub PR automation
POST   /incidents/:incidentId/create-pr
GET    /pull-requests/:id
GET    /incidents/:incidentId/pull-requests
GET    /pull-requests/:id/refresh                  (queries GitHub, updates local status — never merges)
```

Every long-running `POST` above (`investigate`, `reproduce`, `fix`,
`create-pr`) follows the same pattern: it creates a DB row synchronously and
returns `{id, status}` immediately, then runs the actual pipeline (seconds to
low minutes) in the background, persisting status after every stage — poll
the corresponding `GET` to watch it progress. Each has its own precondition
gate (e.g. `create-pr` requires `FixAttempt.result === 'FIX_VERIFIED'`) that
returns a `400` with a machine-readable `error` code before a doomed run
would ever start.

## SDK (`@rootly.ai/node`)

```ts
import { RootlyAI } from "@rootly.ai/node";

const rootlyAI = new RootlyAI({
  apiKey: process.env.ROOTLY_AI_API_KEY!,
  serverUrl: "http://localhost:3001",  // default
  serviceName: "payment-service",
  environment: "production",
  release: "1.0.0",
  debug: true,
});

rootlyAI.init();                          // wires uncaughtException / unhandledRejection
rootlyAI.captureException(error);          // manual capture
rootlyAI.captureMessage("Something odd");  // manual, non-exception message
```

- Never throws into the host app; a failed send is swallowed (debug-logged only if `debug: true`).
- `enabled: false` makes every capture call a no-op — no event is ever sent.
- Delivery is fire-and-forget over `fetch`, 5s timeout, no queue/retry/batching.
- Debug logs never include the API key or `Authorization` header (verified by a test).
- Not published to npm — consumed via the npm workspace; `npm run build:sdk` before running
  the demo app or anything else that imports it.

## The AI pipeline, briefly

- **Investigation (`@rootly.ai/agent`, Phase 5)** — a LangGraph state machine
  (`UNDERSTAND_ERROR → ANALYZE_CODE → ANALYZE_HISTORY → GENERATE_HYPOTHESES →
  EVALUATE_EVIDENCE → GENERATE_REPORT`) that produces ranked root-cause
  hypotheses. Every LLM call uses Zod-validated structured output with one
  retry on schema failure; every evidence claim must cite context actually
  supplied to the model — grounded, not invented.
- **Reproduction (`@rootly.ai/reproduction`, Phase 6)** — an LLM writes a
  Jest test that should fail the way production did; the test is statically
  validated (no `fs`, `child_process`, `eval`, network APIs), then **actually
  executed** against the real repository, checked out at the incident's exact
  commit, inside a network-disabled, no-host-mount, resource-capped, ephemeral
  Docker container. A deterministic classifier (real exit code + output
  pattern, never the LLM) decides `REPRODUCED` / `NOT_REPRODUCED` /
  `INCONCLUSIVE`.
- **Fix generation + validation (`@rootly.ai/fix-engine`, Phase 7)** — given
  a `REPRODUCED` incident, an LLM proposes a minimal patch; the system
  independently verifies the AI's claimed "original code" against the real
  file (rejecting hallucinations before applying anything), applies the
  patch in a **fresh** sandbox, re-runs the reproduction test (must still
  fail pre-patch), runs a post-fix validation test (must now pass), and runs
  regression tests — all before ever trusting the word `FIX_VERIFIED`.
- **PR automation (`@rootly.ai/github`, Phase 8)** — promotes the *exact*
  already-verified patch (never regenerated) into a real GitHub branch,
  commit, and pull request, with its own integrity check (a hash of the
  patch, recomputed and compared before every promotion) and its own fresh,
  ephemeral checkout. Stops at a real PR — no merge, no deploy, ever.

## Testing

```bash
npm run test:sdk           # packages/sdk-node — node:test, mocked fetch
npm run test:agent         # packages/agent — node:test, scripted/fake LLM
npm run test:reproduction  # packages/reproduction — node:test, real Docker required
npm run test:fix-engine    # packages/fix-engine — node:test, real Docker required
npm run test:github        # packages/github — node:test, real git (local repos, no live GitHub needed)
npm run test:api           # apps/api — node:test, real Postgres + real Docker, GitHub REST mocked via nock
```

All packages use Node's built-in test runner (via `tsx`) — no Jest/Vitest
dependency anywhere in this codebase (Jest is what the AI-generated
reproduction/validation *tests* run under, inside the sandbox — a different
thing). `test:reproduction`, `test:fix-engine`, and `test:api` need Postgres
(`docker compose up -d`) and Docker running locally, plus the sandbox image
built (see step 6 above). No test in the standard suite requires live OpenAI
or GitHub credentials — LLM calls use a scripted fake implementing the same
interface as the real client, and GitHub REST calls are mocked with `nock`;
where a real `git` push is exercised (Phase 8), it targets a local bare
repository created for that test, never a real GitHub remote.

## Security

- **Sandbox isolation** (Phases 6-7): every container runs `--network none`,
  never mounts a host path (code enters only via `docker cp`, a one-way
  copy), never references the Docker socket, has explicit memory/CPU/PID
  caps, is killed on timeout, and is always removed in a `finally` block —
  proven with real containers in `docker-sandbox.security.test.ts`.
- **Commands are never assembled from AI output**, anywhere in this
  codebase. Every process this system runs — inside a sandbox or on the
  host, git or Jest — is a fixed argv array this code builds; the model
  only ever produces file *content*.
- **Anti-hallucination grounding** (Phases 5-8): an AI claim about existing
  code — a file path, line numbers, "the original code says X" — is checked
  against the real, current file content before it's trusted. A mismatch
  rejects the claim; it's never silently applied.
- **Patch integrity** (Phase 7→8): the patch pushed to GitHub is verified
  byte-for-byte identical (via a stored SHA-256 hash) to the one a sandbox
  already proved works. Promotion never regenerates or "improves" a patch.
- **Human-in-the-loop by construction**: nothing in this codebase calls a
  merge, approval, or deployment API. `FIX_VERIFIED` requires real sandbox
  execution, not AI self-assessment; a GitHub PR is the last automated step.
- **Secrets**: GitHub PATs are AES-256-GCM encrypted at rest, decrypted only
  in-process, used as a one-off git credential override (never written to
  `.git/config`, never a persistent env var, never forwarded into a
  sandbox), and never appear in logs or API responses — verified by tests
  in every phase that touches a token.

## Demo flow

1. `GET /test-error` on the running demo app — a real, uncaught `TypeError`
   from `payment.service.js`, captured by the SDK.
2. The dashboard shows a new incident. Connect the GitHub repository (once)
   and collect code context.
3. Click **Investigate** — the AI identifies that `customer` can be `null`
   before `.id` is accessed.
4. Click **Reproduce Bug** — a generated Jest test actually throws the same
   `TypeError` inside a Docker sandbox: **✓ REPRODUCED**.
5. Click **Generate Fix** — the AI proposes optional-chaining null handling.
6. The fix is applied and validated in a *fresh* sandbox: before-fix
   reproduction still fails, post-fix validation passes, regression tests
   pass: **✓ FIX VERIFIED**.
7. Click **Create GitHub PR** — a real branch, commit, and pull request are
   created from the exact verified patch.
8. The dashboard shows **✓ Pull Request Created**, the PR number, branch,
   and an **Open Pull Request** link to the real GitHub PR — where a human
   reviews the incident, root cause, reproduction, fix, and diff, and
   decides whether to merge it.

## Known limitations

- No auth/accounts — anyone with dashboard access can manage all projects.
- One language/framework combo throughout: JavaScript/TypeScript + Jest.
  Extending to another stack means new validators and a new sandbox image,
  not a config flag (a deliberate MVP scoping decision, not an oversight).
- Dependency installation for reproduction/validation only works when the
  sandbox image already has what's needed cached — see
  `packages/reproduction/README.md`'s tradeoff section.
- No "optional final re-test" inside Phase 8's promotion step — `FIX_VERIFIED`
  already means Phase 7 ran the reproduction test, post-fix test, and
  regression tests in a sandbox moments earlier; see
  `packages/github/README.md`'s known limitations for the reasoning.
- No sophisticated GitHub rate-limit handling — a single classified failure
  and no automatic retry.
- No queue/worker (Redis, BullMQ, etc.) anywhere — every async pipeline runs
  as a fire-and-forget function inside the API process. Fine for this
  project's scope; none of the packages' own APIs assume where they're
  called from, so moving one behind a real queue later doesn't require
  reshaping it.
- SDK delivery is send-immediately with no local queue — an app that
  crashes before the `fetch` resolves can lose that one event.
- The API started on NestJS; it was rewritten to plain Express because the
  NestJS 12 upgrade needed to clear its remaining `npm audit` findings is
  currently blocked upstream. The Express rewrite carries **0 known
  vulnerabilities** and the same routes/behavior.
