# @rootly.ai/github

Phase 8 of rootly.ai — the final core phase. Given an incident whose fix has
already been **verified by a real sandbox execution** (Phase 7), this package
promotes that exact, already-proven patch into a real GitHub branch, commit,
and pull request. It closes the loop:

```
ERROR → INCIDENT → ROOT CAUSE → REPRODUCED → FIX VERIFIED → GITHUB PR → HUMAN REVIEW
```

**This package never merges, approves, or deploys anything.** It stops the
instant a pull request exists. A human remains the only thing that can put
code into production.

## What this package deliberately does not do

- **It does not regenerate the fix.** Phase 7 already produced and validated
  `FixAttempt.patch` / `FixPatch.patchedContent`. This package pushes exactly
  those bytes — never a re-run of the fix-generation LLM, never an "improved"
  version. See [patch integrity](#patch-integrity) for how that's enforced,
  not just assumed.
- **It does not merge the pull request.** There is no merge call anywhere in
  this codebase. `PullRequest.status` tracks `OPEN`/`CLOSED`/`MERGED` purely
  as *observed* GitHub state (see `refreshPullRequest`), never as something
  this package causes.
- **It does not touch the repository's default branch.** Every git operation
  targets a freshly created `incident/<n>/fix-...` branch; pushing to the
  default branch is refused outright (see [security model](#security-model)).
- **It does not call a new LLM.** Nothing in this package makes a model call.
  The only AI-derived input anywhere in this pipeline is text already
  generated and stored in earlier phases (the fix explanation, used as commit
  message / PR title material) — used as *content*, never as instructions
  for which GitHub operations to run.

## Architecture

```
packages/github/src/
├── client/
│   └── github-client.ts       Octokit wrapper — the fixed, backend-controlled
│                                set of GitHub REST operations this package
│                                is allowed to call. Nothing else, ever.
├── branch/
│   └── branch-manager.ts      deterministic branch naming (slugify,
│                                generateBranchName) + GitHub-side uniqueness
│                                resolution (resolveUniqueBranchName)
├── commit/
│   └── commit-manager.ts      backend-templated commit title/body
├── pull-request/
│   └── pull-request-manager.ts backend-templated PR title/body
├── patch/
│   └── patch-integrity.ts     sha256 hash + verification — the Phase 7 ->
│                                Phase 8 trust boundary
├── promotion/
│   ├── promotion-validator.ts  re-checks Phase 7's forbidden-path/size-limit
│   │                            rules, plus "only the expected files changed"
│   ├── promotion-checkout.ts   a *separate* checkout from Phase 6/7's —
│   │                            deliberately keeps .git, since this one
│   │                            needs to commit and push
│   └── pr-promotion.ts         the top-level orchestrator: the whole
│                                branch -> checkout -> apply -> validate ->
│                                commit -> push -> PR pipeline
└── index.ts
```

Like `@rootly.ai/agent`, `@rootly.ai/reproduction`, and
`@rootly.ai/fix-engine`, this package has no Prisma or Express dependency.
`apps/api` (see `src/pull-requests/pull-requests.service.ts`) loads the
incident, repository, and latest `FIX_VERIFIED` `FixAttempt` from the
database, decrypts the repository token, and hands this package a plain
`PrPromotionInput`. `apps/api` owns persisting the `PullRequest` row and
updating its status.

It depends on `@rootly.ai/reproduction` for `runGit` (the same minimal-env
git subprocess wrapper Phase 6/7 use) and on `@rootly.ai/fix-engine` for
`FORBIDDEN_PATH_PATTERNS` / `DEFAULT_PATCH_SAFETY_LIMITS` — reusing the exact
same trust-boundary constants rather than maintaining a second copy of them.

## Patch integrity

The single most important guarantee in this phase: **the patch pushed to
GitHub is byte-for-byte the patch a sandbox already proved works.**

1. When Phase 7 persists a `FIX_VERIFIED` `FixAttempt`, `apps/api` computes
   `validatedPatchHash = computePatchHash(patch)` (`sha256:<hex>`) and stores
   it alongside the patch.
2. Before Phase 8 does anything else, it recomputes the hash of the current
   `FixAttempt.patch` and requires it to still equal `validatedPatchHash`
   (`verifyPatchIntegrity`). A mismatch — the field was edited, corrupted, or
   somehow replaced between phases — aborts with `PATCH_INTEGRITY_FAILED`
   before a single GitHub API call is made.
3. Promotion applies `FixPatch.patchedContent` directly (the exact final
   content Phase 7 already wrote and validated) — it does not re-parse or
   reapply the structured line-range changes a second time.
4. Before writing that content, promotion independently re-verifies the
   *real, freshly checked-out* file still equals `FixPatch.originalContent`
   — the same "trust nothing, verify against the real file" boundary Phase 7
   itself uses, checked again here because time has passed and the base
   branch could have moved.

## Security model

**Only a verified fix can ever reach this package.** `apps/api`'s
precondition check requires `FixAttempt.result === 'FIX_VERIFIED'` — a
`PENDING`, `GENERATING_FIX`, `FIX_REJECTED`, or `INCONCLUSIVE` attempt is
refused with `PR_CREATION_PRECONDITION_FAILED` before any branch is created.

**The default branch can never be a push target.** Two independent layers:
`generateBranchName` always produces `incident/<n>/fix-...`, and
`runPrPromotion` additionally refuses outright (`BRANCH_CREATION_FAILED`) if
the resolved branch name ever equals `defaultBranch` — belt and suspenders
for a property named explicitly as a security requirement, not left to a
naming convention alone.

**Branch names can't carry path traversal.** `slugify` strips everything but
`[a-z0-9\s-]` before any path segment is built — `../../etc/passwd` becomes
`etcpasswd`, never a `..` or `/` in the output. See
`branch-manager.test.ts`'s traversal-input suite.

**Commands are never assembled from AI output**, exactly as in Phase 6/7 —
every git invocation here is a fixed argv array built by this package's own
code (`pr-promotion.ts`'s `commitAll`/`pushBranch`), never a shell string and
never anything derived from a model response. The GitHub REST surface is
equally fixed: `github-client.ts` exposes exactly the six operations this
pipeline needs (get default branch, get/create a branch ref, create/get a
pull request) — there is no generic "call this GitHub endpoint" capability
for anything, AI-driven or otherwise, to reach for.

**Unexpected file changes block promotion.** After patches are written to
the fresh checkout, `git diff --name-only` (plus `git ls-files --others`) is
compared against exactly the file set `FixPatch` recorded —
`validateChangedFileSet` fails if anything else changed, or if an expected
file didn't.

**The GitHub token** is decrypted once in `apps/api`, passed to this package
only as an in-memory string, and used only as a one-off `-c
http.extraHeader=Authorization: Bearer ...` override on the two git
subprocess calls that need it (clone, push) — global git config only, per
Phase 6's established pattern, never written to `.git/config`, never a
persistent env var, never logged (`GitHubClient`'s `sanitize()` strips
Octokit's own request/response objects — which carry the Authorization
header — off of every thrown error), and never returned in any API response
(`PULL_REQUEST_SELECT` in `pull-requests.service.ts` has no token field to
leak in the first place).

**Rate limits fail closed, not aggressively.** A 403 whose message matches
GitHub's rate-limit wording is classified as `GITHUB_RATE_LIMITED` and
persisted with a plain "GitHub API rate limit reached." message — no retry
loop, no backoff strategy. This is an MVP-scoped choice, not an oversight
(see [Known limitations](#known-limitations)).

## Fresh promotion checkout — and why it's not Phase 6/7's sandbox

Phase 6/7's `checkoutRepository` deletes `.git` immediately after checkout,
because that checkout only ever needs to be *read and executed* inside a
network-disabled Docker container. Promotion needs to commit and push, so it
has its own `checkoutForPromotion` (`promotion/promotion-checkout.ts`) that
keeps `.git` — a deliberate, documented difference, not an oversight. This
checkout also never runs inside Docker: applying an already-verified patch
and running a handful of backend-controlled git commands isn't executing
untrusted repository code, unlike Phase 6/7's reproduction/validation steps.
The workspace is still a fresh `mkdtemp` directory, destroyed in `finally`
regardless of outcome, exactly like every other checkout in this project.

## Classification

`runPrPromotion` never asks a model whether something succeeded — every
outcome comes from a real git exit code or a real GitHub API response:

| Stage | Failure code |
|---|---|
| Patch fails the promotion-time safety re-check | `PROMOTION_VALIDATION_FAILED` |
| `git branch`/create-ref on GitHub fails (including "branch already exists") | `BRANCH_CREATION_FAILED` |
| Branch name equals the default branch | `BRANCH_CREATION_FAILED` |
| Checkout of the newly created branch fails | `GITHUB_API_FAILED` |
| Real file content no longer matches `FixPatch.originalContent` | `PATCH_APPLICATION_FAILED` |
| The actual changed-file set doesn't match what was expected | `PROMOTION_VALIDATION_FAILED` |
| `git commit` fails | `COMMIT_FAILED` |
| `git push` fails | `PUSH_FAILED` |
| GitHub rate-limits the request | `GITHUB_RATE_LIMITED` |
| PR creation fails for any other GitHub-API reason | `GITHUB_API_FAILED` |
| Anything else unexpected | `PR_CREATION_FAILED` |

`PullRequest.status` only ever moves `CREATING -> OPEN` (success) or
`CREATING -> FAILED` (any of the above) at creation time; `CLOSED`/`MERGED`
are set later, only by `refreshPullRequest` observing real GitHub state.

## Idempotency

Before creating a new `PullRequest` row, `apps/api` checks for an existing
one on the same `FixAttempt` with status `OPEN` or `CREATING` and returns it
unchanged rather than starting a second promotion — see
`pull-requests.test.ts`'s "calling again for the same FixAttempt must return
the same PR" assertion. A `CLOSED`/`FAILED` prior attempt doesn't block a new
one (the MVP-simplest safe rule from the phase spec: *one active PR per
FixAttempt*).

## Running it

```bash
npm run build --workspace=@rootly.ai/github   # apps/api consumes dist/, not src/
npm run test --workspace=@rootly.ai/github     # unit tests + real-git integration tests
```

The integration tests (`pr-promotion.test.ts`) use a **local bare git
repository** as the push target, with a `FakeGitHubClient` that manipulates
that same repo directly for branch lookup/creation and returns a canned PR
for `createPullRequest` — real `git clone`/`checkout`/`commit`/`push`
subprocess calls run for real, but no live GitHub credentials or network
access are required, and nothing is ever pushed to a real GitHub repository
by the standard test suite. `apps/api/test/pull-requests.test.ts` extends
this same technique through the full HTTP/database layer, including a real
(fast, local, no-Docker-needed) FIX_VERIFIED FixAttempt.

### Optional real-GitHub integration test

Per the phase spec, this package does **not** include a test that pushes to
a real GitHub repository — that would require live credentials and could
spam a real project with branches/PRs every CI run. If you want to verify
against real GitHub by hand, set `GITHUB_TEST_TOKEN` and
`GITHUB_TEST_REPOSITORY` and drive `runPrPromotion` directly against them in
a throwaway script; this is intentionally not wired into the automated test
suite.

### API

```
POST /incidents/:incidentId/create-pr    # starts async, returns {id, status}
GET  /pull-requests/:id                  # poll status while it runs
GET  /incidents/:incidentId/pull-requests  # history, newest first
GET  /pull-requests/:id/refresh          # queries GitHub, updates local status (never merges)
```

Preconditions (a `FIX_VERIFIED` `FixAttempt` with a patch, a target commit,
and a matching integrity hash) are checked before a `PullRequest` row is even
created, returning `400 {"error":"PR_CREATION_PRECONDITION_FAILED","message":
"..."}` or `400 {"error":"PATCH_INTEGRITY_FAILED","message":"..."}` rather
than starting a doomed promotion.

### Demo flow

1. Run the Phase 3-7 flow to a `FIX_VERIFIED` `FixAttempt` for
   `demo-app/src/services/payment.service.js`'s `confirmPayment`.
2. `POST /incidents/:id/create-pr` (or click **Create GitHub PR** in the
   dashboard's Pull Request tab — enabled only when the latest fix is
   verified).
3. The pipeline reserves a unique branch name
   (`incident/<n>/fix-guard-against-a-missing-customer`), creates that branch
   on GitHub at the fix's target commit, checks it out, verifies and applies
   the exact verified patch, confirms only the expected file changed,
   commits with a backend-generated message, pushes, and opens a PR whose
   body is generated from the incident, root cause, reproduction, fix, and
   validation data already on record.
4. The dashboard shows **✓ Pull Request Created**, the PR number, branch,
   and commit, and an **Open Pull Request** button linking to the real
   GitHub PR — where a human reviews and decides whether to merge it.

## Known limitations

- No automatic merge, approval, or deployment — by design, not as a
  near-term roadmap item. See [section 38 of the phase spec] for why: the
  human reviewer is the final authority for the life of this project.
- The "optional final test" the phase spec describes (re-running the
  reproduction test inside a fresh Docker sandbox one more time,
  immediately before push) is **not implemented**. `FIX_VERIFIED` already
  means Phase 7 ran that exact reproduction test, the post-fix validation
  test, and regression tests inside a sandbox moments earlier; re-running
  Jest a second time here would duplicate that infrastructure for a check
  whose only new information is "did the world change in the last few
  seconds," which the promotion-time patch-integrity hash and
  original-content re-verification already catch. If the checked-out base
  branch really has drifted, `PATCH_APPLICATION_FAILED` catches it.
- No sophisticated rate-limit handling — a single classified failure
  (`GITHUB_RATE_LIMITED`) and no automatic retry, matching the phase spec's
  explicit "do not build a sophisticated rate-limit system for MVP."
- One language/framework combo, matching Phase 6/7: JavaScript/TypeScript
  repositories using git over HTTPS.
- No queue/worker — PR creation runs as a fire-and-forget async function
  inside the API process, matching every other async pipeline in this
  project.
