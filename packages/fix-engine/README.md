# @incident-ai/fix-engine

Phase 7 of Incident AI: given an incident whose bug has already been
**confirmed reproduced** (Phase 6), this package proposes a minimal code
patch and — the important part — independently proves whether that patch
actually fixes the bug, by applying it to the real checked-out repository
and running real tests inside a fresh, isolated Docker sandbox.

**AI proposes the patch; the sandbox proves whether the patch works.**

## Why a fix has to be validated, not just generated

An LLM can produce a plausible-looking diff with total confidence and still
be wrong — wrong line numbers, wrong assumption about the surrounding code,
a fix that "resolves" the bug by breaking something else. This package never
trusts the model's own claim that a fix works. It trusts three things
instead, all computed by real, deterministic execution:

1. **The claimed original code is checked against the real file.** Before
   any patch is applied, every change's `originalCode` must exactly match
   the real content of the real file, at the real line range, in the
   freshly checked-out repository at the incident's target commit. A
   mismatch — a hallucinated line, a stale assumption, a shifted line
   number — rejects the whole patch before a single byte of the repository
   is touched.
2. **The same reproduction test from Phase 6 is re-run, twice, in the same
   sandbox lifecycle**: once before the patch is applied (must still show
   the bug — otherwise there's nothing to validate against), and once after
   the AI's own post-fix test is applied (must now show the bug is gone).
3. **Regression tests** (the related tests Phase 4 found near the changed
   file) run afterward, in the same container, against the patched code.

Only real exit codes and real Jest output decide `FIX_VERIFIED` /
`FIX_REJECTED` / `INCONCLUSIVE` — see [classification](#classification).
There is no `confidence` field anywhere in that decision.

## Architecture

```
packages/fix-engine/src/
├── schemas/                 Zod schemas for the three LLM-generated documents
│   ├── fix-analysis.schema.ts        (what should change, and why)
│   ├── fix-proposal.schema.ts        (the structured patch itself)
│   └── post-fix-validation.schema.ts (the AI's after-the-fix assertion)
├── prompts/                  prompt builders, sharing the anti-hallucination
│                              and minimal-change notices from Phase 5/6
├── graph/                     LangGraph: analyze_fix -> generate_patch
│   └── nodes/
├── patch/
│   ├── patch-validator.ts    safety limits, forbidden paths, original-content
│   │                          verification — the core trust boundary
│   ├── patch-parser.ts       deterministic patch application + unified diff
│   ├── patch-generator.ts    runs the fix-generation graph
│   └── post-fix-test-generator.ts   one LLM call for the after-fix test
├── sandbox/
│   ├── fix-sandbox.ts        thin wrapper over @incident-ai/reproduction's
│   │                          DockerSandbox — always a fresh container
│   └── sandbox-runner.ts     builds jest argv for before/after/regression runs
├── validation/
│   ├── reproduction-validator.ts   before/after classification (reused +
│   │                                inverted-polarity Phase 6 logic)
│   ├── regression-validator.ts     Jest summary parsing -> PASSED/FAILED/INFRA_ERROR
│   └── fix-classifier.ts           the single deterministic 3-way decision
├── fix/
│   └── fix-engine.ts         top-level orchestrator: the whole pipeline
└── index.ts
```

This package has no Prisma or Express dependency, exactly like
`@incident-ai/agent` and `@incident-ai/reproduction`. `apps/api` (see
`src/fix-attempts/fix-attempts.service.ts`) loads the incident, the latest
completed investigation, and the latest `REPRODUCED` reproduction run from
the database, decrypts the repository token, and hands this package a plain
`FixGenerationInput`. `apps/api` owns persisting `FixAttempt`/`FixPatch` and
updating status after every stage.

## What this package deliberately does not do

- **It never creates a GitHub PR, pushes a branch, or commits anything to
  the user's real repository.** Every patch is applied to a throwaway `git
  clone` in a host temp directory (via `checkoutRepository`, reused
  unmodified from `@incident-ai/reproduction`), which is deleted in a
  `finally` block regardless of outcome.
- **It never reuses a Phase 6 reproduction sandbox instance.** `fix-sandbox
  .ts`'s `createFixSandbox` always constructs a brand-new `DockerSandbox` —
  a fresh container guarantees what's being tested is exactly "baseline
  commit + this patch," nothing a prior run happened to leave behind.
- **It never lets the AI redefine what gets validated.** The post-fix
  validation test's `filePath` is always overwritten with the *original*
  Phase 6 reproduction test's path (`post-fix-test-generator.ts`) — the
  model can change the test's *content*, never *which file* gets executed.

## Security model

The sandbox itself — network disabled, no Docker socket, no host mounts,
resource-capped, ephemeral, secrets never forwarded — is
`@incident-ai/reproduction`'s `DockerSandbox`, used here **unmodified**; see
`packages/reproduction/README.md#security-model` and
`docker-sandbox.security.test.ts` for that class's own proof. This package
does not duplicate those tests. What it adds on top:

**Patch safety limits** (`patch-validator.ts`, `DEFAULT_PATCH_SAFETY_LIMITS`
= 5 files / 100 changed lines / 50,000 bytes, overridable via
`FIX_MAX_FILES` / `FIX_MAX_CHANGED_LINES` / `FIX_MAX_PATCH_BYTES`):

- a hard-coded forbidden-path list blocks any change touching `.git/`,
  `.env*`, `package.json`, `package-lock.json`, `Dockerfile*`, or `.github/`
- a patch exceeding the file/line/byte limits is rejected outright

**Original-content verification** (`verifyOriginalContent`) — the single
most important trust boundary in this package. It runs twice, at two
different layers:

1. During generation (`matchesCachedContext` in `generate-patch.node.ts`),
   against the code *shown to the model* — a cheap, early rejection before
   any repository is ever checked out.
2. During application (`fix-engine.ts`), against the **real file content of
   the real checked-out repository** — the check that actually matters,
   since the cached context and the real file could in principle diverge.

A mismatch at either layer rejects the patch; it is never silently applied.

**Commands are never assembled from AI output**, exactly as in Phase 6 —
`sandbox-runner.ts` is the only place argv arrays are built, and every one
is passed to `spawn` as a real array, never a shell string.

**Cleanup is unconditional.** `runFixAttempt`'s `finally` block always calls
`sandbox.destroy()` and `checkout.cleanup()` — on a verified fix, a rejected
patch, an early "bug not reproduced" exit, and a thrown exception alike. See
`fix-engine.security.test.ts`, which asserts this with a real container
against a local git repository (the Docker-isolation properties themselves
are proven once, upstream, in `@incident-ai/reproduction` — see that
package's own security suite rather than a duplicate here).

## Classification

`fix-classifier.ts` is the only place that decides `FIX_VERIFIED` /
`FIX_REJECTED` / `INCONCLUSIVE`, in this precedence order, and it never asks
the model:

| Condition | Result |
|---|---|
| The patch was never applied (verification failure, or the bug wasn't reproduced before the patch even reached this stage) | **FIX_REJECTED** |
| Before-fix reproduction was `INCONCLUSIVE` or `NOT_REPRODUCED` | **INCONCLUSIVE** |
| Post-fix validation hit an infra error (not a real test failure) | **INCONCLUSIVE** |
| Post-fix validation test still fails (bug still occurs) | **FIX_REJECTED** |
| Regression tests hit an infra error | **INCONCLUSIVE** |
| Regression tests fail | **FIX_REJECTED** ("fix resolves the incident but breaks existing tests") |
| Everything above passed | **FIX_VERIFIED** |

`FixAttempt.status` (the pipeline state machine) and `FixAttempt.result`
(the classification) are separate in the same way Phase 6 separates
`ReproductionRun.status`/`.result`. `status: FAILED` is reserved for the
*system* breaking (no proposal could be generated, Docker itself couldn't
create a container); everything that reaches an actual conclusion —
including a rejected or inconclusive one — resolves to `status: COMPLETED`.

## Running it

Prerequisites: Docker running locally, and the Phase 6 sandbox image built
(`incident-ai-reproduction-sandbox` — see `packages/reproduction/README.md`;
this package reuses the same image, no separate build needed).

```bash
npm run build --workspace=@incident-ai/fix-engine   # apps/api consumes dist/, not src/
npm run test --workspace=@incident-ai/fix-engine     # unit + mocked-LLM + real-Docker tests
```

End to end, from the API:

```
POST /incidents/:incidentId/fix                # starts async, returns {id, status}
GET  /fix-attempts/:id                          # poll status/result while it runs, includes patches
GET  /incidents/:incidentId/fix-attempts        # history, newest first
```

Preconditions (a completed investigation with real evidence, and a latest
reproduction run with `result: REPRODUCED` and a saved generated test) are
checked before a `FixAttempt` row is even created, returning `400
{"error":"FIX_PRECONDITION_FAILED","message":"..."}` rather than starting a
doomed attempt.

### Demo flow

1. Run the Phase 3-6 flow to get an incident with a `REPRODUCED`
   reproduction run (`demo-app/src/services/payment.service.js`'s
   `confirmPayment` crashing on a `null` customer).
2. `POST /incidents/:id/fix` (or click **Generate Fix** in the dashboard's
   Fix tab).
3. The pipeline proposes guarding `payment.customer.id` with optional
   chaining, checks out the repository at the incident's target commit,
   verifies the claimed original line for real, applies the patch, re-runs
   the Phase 6 reproduction test (still fails, confirming the checkout is
   the same buggy baseline), applies the patch, runs the AI's post-fix test
   (now passes), runs the nearby `payment.service.spec.js` regression test,
   and reports `FIX_VERIFIED`.

## Known limitations

- One language/framework combo, matching Phase 6: JavaScript/TypeScript +
  Jest.
- Dependency installation has the same MVP boundary as Phase 6 — a patch
  that needs a package not already cached in the sandbox image cannot be
  validated offline. See `packages/reproduction/README.md`'s tradeoff
  section; the same reasoning applies here unchanged.
- No GitHub integration for the fix itself: no branch, no commit, no PR. A
  verified fix is a proven diff sitting in the database (`FixPatch.diff`),
  ready for a human — or a future phase — to actually open a PR from.
- No queue/worker — fix attempts run as a fire-and-forget async function
  inside the API process, matching every other async pipeline in this
  project.
- A `FixAttempt` always resolves out of a non-terminal status, even on an
  unexpected exception (`executeFixAttempt`'s `catch` in
  `fix-attempts.service.ts` marks the row `FAILED` with the error message
  rather than leaving it stuck `GENERATING_FIX` forever).
