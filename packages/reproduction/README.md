# @incident-ai/reproduction

Phase 6 of Incident AI: given a root-cause report from the Phase 5 investigation
agent, this package proves — or disproves — that the underlying bug actually
reproduces, by generating a test and **actually executing it** against the
real repository code inside an isolated Docker sandbox.

## What "reproduction" means here

The AI investigation agent (`@incident-ai/agent`) can be wrong. A confident,
well-evidenced root-cause report is still a hypothesis until something
independent checks it. This package is that check:

1. An LLM reads the incident, the investigation's root cause, and the actual
   source code, and writes a Jest test that should fail the same way
   production did.
2. The test is statically validated against a safety allowlist (see
   [Generated-test validation](#generated-test-validation) below).
3. The **real repository**, checked out at the commit the incident actually
   ran against, is copied into a throwaway, network-disabled Docker container.
4. The test runs for real, inside that container, against the real code.
5. A deterministic, code-only classifier — never the LLM — decides the result
   from the test's actual exit code and output.

**The AI generates the reproduction test, but the execution environment
determines whether the bug was actually reproduced.** A hypothesis that
compiles and sounds right is worth nothing here unless Jest actually agrees.

## Architecture

```
packages/reproduction/src/
├── schemas/                Zod schemas for the two LLM-generated documents
│   ├── failure-understanding.schema.ts   (what exactly must be reproduced)
│   └── reproduction.schema.ts            (the generated test itself)
├── prompts/                 prompt builders for each LLM call
├── graph/                    LangGraph: UNDERSTAND_FAILURE -> GENERATE_TEST
│   └── nodes/
├── test/
│   ├── test-generator.ts    runs the graph, returns a validated test or fails
│   ├── test-validator.ts    static safety gate (paths, forbidden APIs)
│   └── test-runner.ts       builds the backend-controlled argv (jest, npm)
├── repository/
│   ├── repository-checkout.ts   host-side git clone/checkout, credential-safe
│   └── git-utils.ts
├── sandbox/
│   ├── docker-sandbox.ts    create / copyIn / run / destroy one container
│   ├── sandbox-config.ts    REPRODUCTION_* env vars -> typed config
│   └── sandbox-result.ts
├── reproduction/
│   ├── reproduction-engine.ts       orchestrates the whole pipeline
│   ├── reproduction-classifier.ts   deterministic REPRODUCED/NOT/INCONCLUSIVE
│   └── target-commit.ts             which commit to check out
└── index.ts
```

This package has no Prisma or Express dependency. `apps/api` (see
`src/reproductions/reproductions.service.ts`) loads the incident,
investigation, and code context from the database, decrypts the repository
token, and hands this package a plain `ReproductionEngineInput` — the same
shape `@incident-ai/agent` uses for investigations. `apps/api` also owns
persisting `ReproductionRun`/`ReproductionTest` and updating status after
every stage.

## Security model

The sandbox executes repository code. Repository code is untrusted input,
full stop — even though today it's this project's own demo app, the pipeline
is built as if it were a stranger's repository, because eventually it will be.

**The container:**

- always runs with `--network none` — there is no network toggle, no
  "install phase" that turns it back on; if a run needs network, see
  [the dependency-installation tradeoff](#dependency-installation-tradeoff)
- never mounts anything from the host. Code enters via `docker cp` — a
  one-way copy into the container's own filesystem layer — never a live bind
  mount, so the container never has a path back to any host directory
- never references, let alone mounts, the Docker socket. There is no
  Docker-in-Docker anywhere in this pipeline
- has explicit `--memory`, `--cpus`, and `--pids-limit` caps
- has `--cap-drop ALL --security-opt no-new-privileges`
- is killed via `docker kill` (which terminates every process inside it, not
  just the CLI client watching it) the instant `REPRODUCTION_TIMEOUT_MS`
  elapses
- is always removed (`docker rm -f`) in a `finally` block — on success, on a
  failing test, on a timeout, and on an unexpected exception. See
  `docker-sandbox.security.test.ts`, which asserts this with real containers.
- never receives the host process's environment. `spawn` is called with an
  explicit, minimal `env`, never `process.env`
- never receives OpenAI keys, GitHub tokens, or any other secret. The GitHub
  token (only ever needed for a private repo) is decrypted in `apps/api`,
  used for exactly one `git clone` invocation via a one-off
  `-c http.extraHeader` override (never written to `.git/config`, never a
  persistent env var), and `.git/` is deleted from the checkout before it is
  ever copied into the sandbox — so even the credential material's presence
  on disk, not just its value, never reaches the container
- if that token turns out to be wrong or unnecessary (e.g. a stale token
  connected against what is actually a public repo), the clone retries once
  **without** credentials — this can only ever succeed when the repo was
  reachable anonymously anyway, so it can't grant access a correctly-scoped
  token wouldn't already have; it just avoids a false checkout failure

**Commands are never assembled from AI output.** The LLM produces test
*content* (a string that becomes a file) — never a command. `test-runner.ts`
is the only place that builds argv arrays (`['jest', path, '--ci',
'--runInBand']`, `['npm', 'ci', ...]`), and every one of them is a real
`argv` array passed to `spawn` — never a shell string, never `exec()`,
never anything with `shell: true`. A generated test that tried to smuggle a
command via a crafted string couldn't run one — see
`docker-sandbox.security.test.ts`'s shell-metacharacter test.

### Generated-test validation

Before a generated test ever touches disk, `test-validator.ts` rejects it if:

- `filePath` is absolute, contains `..`, or isn't under `reproduction-tests/`
- the extension isn't `.test.js` / `.test.ts` / `.spec.js` / `.spec.ts`
- the content doesn't look like an actual Jest test (`describe`/`it`/`test`
  with an `expect(...)`)
- the content references `child_process`, `exec`/`spawn`/`execSync`/
  `spawnSync`, `eval`/`new Function`, a shell invocation, `process.env`,
  `fs`/`fs/promises`, or a network client (`fetch`, `axios`, `node-fetch`,
  raw `http`/`https`/`net`/`dns`/`tls`)

If the model's first attempt fails this check, it gets exactly one retry with
the specific violation explained back to it (mirroring the schema-validation
retry from `@incident-ai/agent`). A second failure marks the run `FAILED`.
This is a **static, pattern-based gate** — it is not itself a sandbox. The
sandbox (network-disabled, no host mounts, resource-capped, ephemeral) is
what actually contains a test that got past it anyway.

## Sandbox image

For MVP: `packages/reproduction/docker/sandbox.Dockerfile`, built on
`node:22-bookworm-slim` with `git` and a **globally installed** `jest`
baked in at image-build time (when the network is available, under your
control — not at request time). Build it once:

```bash
docker build -t incident-ai-reproduction-sandbox \
  -f packages/reproduction/docker/sandbox.Dockerfile \
  packages/reproduction/docker
```

`REPRODUCTION_DOCKER_IMAGE` points the engine at this image (or your own).

### Dependency-installation tradeoff

The engine can detect a `package-lock.json` and run `npm ci` (never `npm
install` when a lockfile exists — see `test-runner.ts`), but that only ever
runs *inside* the network-disabled container, so it only succeeds if the
requested packages are already in the image's npm cache. For a repository
whose test target depends on packages beyond that, you have two honest
options, and this MVP intentionally does not build either as automatic
infrastructure:

1. **Bake the real dependencies into the sandbox image** (extend the
   Dockerfile to `COPY` the relevant `package.json`/lockfile and `RUN npm
   ci` at build time — the same idea as the global `jest` install here, just
   scoped to a real project).
2. **Run installation as an explicit, separate, network-enabled preparation
   step** you control — never inside the same network-disabled container
   that executes the untrusted test.

The demo repository's target file (`demo-app/src/services/payment.service.js`)
has zero external dependencies, so this MVP sidesteps the problem entirely:
`requiresDependencyInstall()` inspects the generated test's imports, and
since it only ever references a relative path back into the checked-out
repo, no install step runs at all — the whole pipeline stays offline from
the first container command onward.

## Reproduction result: how classification actually works

`reproduction-classifier.ts` is the only place that decides
REPRODUCED / NOT_REPRODUCED / INCONCLUSIVE, and it never asks the model:

| Condition | Result |
|---|---|
| Jest exits `0` | **REPRODUCED** — the test's assertion of the expected failure held |
| Jest exits non-zero, no infra-failure signature in the output | **NOT_REPRODUCED** — the test ran cleanly but the assertion didn't hold |
| Output matches an infra-failure signature (`Cannot find module`, `SyntaxError`, `Test suite failed to run`, `npm ERR!`, `ENOENT`, ...) | **INCONCLUSIVE** |
| The container was killed by the timeout | **INCONCLUSIVE** |
| No exit code was ever observed | **INCONCLUSIVE** |

The distinction that matters most: **"Cannot find module" is never
NOT_REPRODUCED.** A test environment failing to run is not evidence the bug
is absent — conflating the two would make every checkout/dependency hiccup
look like proof the incident never happened.

`ReproductionRun.status` (the pipeline state machine) and
`ReproductionRun.result` (the classification) are deliberately separate.
`FAILED` status is reserved for the reproduction *system* breaking — test
generation never produced a test, or Docker itself couldn't create a
container. Everything that got far enough to attempt execution but couldn't
get a clean signal (checkout failure, dependency install failure, timeout)
resolves to `status: COMPLETED, result: INCONCLUSIVE` — a more useful
dashboard story than an undifferentiated failure with no classification.

## Running it

Prerequisites: Docker running locally, and the sandbox image built (above).

```bash
npm run build --workspace=@incident-ai/reproduction   # apps/api consumes dist/, not src/
npm run test --workspace=@incident-ai/reproduction     # unit + real-Docker security tests
```

End to end, from the API:

```
POST /incidents/:incidentId/reproduce     # starts async, returns {id, status}
GET  /reproduction-runs/:id               # poll status/result while it runs
GET  /incidents/:incidentId/reproduction-runs   # history, newest first
```

Preconditions (checked before a run is even created — a completed
investigation and a `READY` code context, each with real evidence and a
resolved primary file/line) return `400
{"error":"REPRODUCTION_PRECONDITION_FAILED","message":"..."}` rather than
starting a doomed run.

### Demo flow

1. Hit `/test-error` on the running demo app — produces the incident.
2. Collect code context, run an AI investigation (Phases 4/5).
3. `POST /incidents/:id/reproduce` (or click **Reproduce Bug** in the
   dashboard's Reproduction tab).
4. The pipeline generates a Jest test for `demo-app/src/services/payment
   .service.js`'s `confirmPayment`, clones the repository at the commit the
   incident actually ran against, runs the test inside the sandbox, and
   reports `REPRODUCED` — because the test really does throw `TypeError`
   against the real, unmodified source.

## Known limitations

- Dependency installation only works when the sandbox image already has
  what's needed cached — see the tradeoff above. This is an MVP scoping
  decision, not an oversight.
- One language/framework combo for MVP: JavaScript/TypeScript + Jest. The
  schema and validator are written narrowly on purpose (see `TESTING
  REQUIREMENTS` in the phase spec) — extending to other stacks means new
  validators and a new sandbox image, not a config flag.
- `docker exec` is used to run the actual test inside an already-started
  keep-alive container (rather than making the test the container's PID 1),
  so a client-side `docker` CLI hiccup mid-run is handled by killing the
  container directly rather than relying on the CLI's own exit.
- No queue/worker (Redis, BullMQ) — reproduction runs as a fire-and-forget
  async function inside the API process. Fine for an MVP's request volume;
  the engine's own API (`runReproduction`) doesn't care where it's called
  from, so moving it behind a real queue later doesn't require reshaping it.
- Target-commit resolution prefers the most recent commit Phase 4 associated
  with the incident's primary file, falling back to the repository's default
  branch (resolved to a concrete sha at checkout time via `git rev-parse
  HEAD`, so what's persisted is always a real, deterministic commit — never
  just a branch name that could drift out from under a later re-run).
