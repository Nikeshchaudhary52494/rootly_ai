import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from '@rootly.ai/reproduction';
import { DEFAULT_PATCH_SAFETY_LIMITS, type PatchSafetyLimits } from '@rootly.ai/fix-engine';
import type { GitHubClient } from '../client/github-client';
import { GitHubClientError } from '../client/github-client';
import { checkoutForPromotion, PromotionCheckoutError, type PromotionCheckoutResult } from './promotion-checkout';
import { validatePromotionPatchSet, validateChangedFileSet } from './promotion-validator';

const BOT_NAME = 'rootly.ai';
const BOT_EMAIL = 'rootly.ai@users.noreply.github.com';
const DEFAULT_TIMEOUT_MS = 60000;

export type PrPromotionStage =
  | 'VALIDATING_PATCH'
  | 'CREATING_BRANCH'
  | 'CHECKING_OUT'
  | 'APPLYING_PATCH'
  | 'COMMITTING'
  | 'PUSHING'
  | 'CREATING_PULL_REQUEST';

export type PrPromotionErrorCode =
  | 'BRANCH_CREATION_FAILED'
  | 'PATCH_APPLICATION_FAILED'
  | 'PROMOTION_VALIDATION_FAILED'
  | 'COMMIT_FAILED'
  | 'PUSH_FAILED'
  | 'GITHUB_API_FAILED'
  | 'GITHUB_RATE_LIMITED'
  | 'PR_CREATION_FAILED';

export interface PrPromotionPatch {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
}

export interface PrPromotionInput {
  owner: string;
  repo: string;
  repositoryUrl: string;
  /** Decrypted token for a private repo — used only for this promotion's clone/push, never persisted or logged. */
  accessToken?: string;
  defaultBranch: string;
  targetCommitSha: string;
  /**
   * Already resolved to a real, currently-unique name by the caller (see
   * @rootly.ai/github's branch-manager) before this function is ever
   * invoked — resolving it here, after a DB row may already reference a
   * candidate name, would risk the DB and GitHub disagreeing about which
   * name is actually free. This function only ever creates *this* branch,
   * never renames or re-picks one.
   */
  branchName: string;
  /** The exact FixPatch rows from the FIX_VERIFIED attempt — never regenerated, never modified. */
  patches: PrPromotionPatch[];
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

export interface PrPromotionOptions {
  client: GitHubClient;
  patchLimits?: PatchSafetyLimits;
  timeoutMs?: number;
  onStage?: (stage: PrPromotionStage) => void | Promise<void>;
}

export interface PrPromotionResult {
  status: 'CREATED' | 'FAILED';
  errorCode: PrPromotionErrorCode | null;
  errorMessage: string | null;
  branchName: string | null;
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
}

function failed(errorCode: PrPromotionErrorCode, errorMessage: string, branchName: string | null = null): PrPromotionResult {
  return { status: 'FAILED', errorCode, errorMessage, branchName, commitSha: null, prNumber: null, prUrl: null };
}

/**
 * VALIDATING_PATCH -> CREATING_BRANCH -> CHECKING_OUT -> APPLYING_PATCH ->
 * COMMITTING -> PUSHING -> CREATING_PULL_REQUEST, always destroying the
 * fresh checkout in `finally`. Never re-generates or edits the patch — every
 * byte written to disk here is `patch.patchedContent`, exactly as Phase 7
 * validated it. Never pushes to `input.defaultBranch`; the branch pushed is
 * always the freshly created incident branch.
 */
export async function runPrPromotion(input: PrPromotionInput, options: PrPromotionOptions): Promise<PrPromotionResult> {
  const limits = options.patchLimits ?? DEFAULT_PATCH_SAFETY_LIMITS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const emit = async (stage: PrPromotionStage) => {
    await options.onStage?.(stage);
  };

  await emit('VALIDATING_PATCH');
  const safety = validatePromotionPatchSet(
    input.patches.map((p) => ({ filePath: p.filePath, diff: p.diff })),
    limits,
  );
  if (!safety.valid) {
    return failed('PROMOTION_VALIDATION_FAILED', safety.reasons.join('; '));
  }

  await emit('CREATING_BRANCH');
  const branchName = input.branchName;
  // Defense in depth: generateBranchName always prefixes with `incident/<n>/fix-`, so this
  // should be structurally impossible — but "never push to the default branch" is a named
  // security requirement, not an incidental one, so it gets its own explicit check rather
  // than relying solely on that prefix.
  if (branchName === input.defaultBranch) {
    return failed('BRANCH_CREATION_FAILED', 'refusing to use the repository default branch as the incident branch', branchName);
  }
  try {
    await options.client.createBranchRef(input.owner, input.repo, branchName, input.targetCommitSha);
  } catch (err) {
    if (err instanceof GitHubClientError && err.code === 'RATE_LIMITED') {
      return failed('GITHUB_RATE_LIMITED', 'GitHub API rate limit reached.', branchName);
    }
    return failed('BRANCH_CREATION_FAILED', messageOf(err), branchName);
  }

  let checkout: PromotionCheckoutResult | null = null;
  try {
    await emit('CHECKING_OUT');
    try {
      checkout = await checkoutForPromotion({
        repositoryUrl: input.repositoryUrl,
        ref: branchName,
        accessToken: input.accessToken,
        timeoutMs,
      });
    } catch (err) {
      return failed('GITHUB_API_FAILED', `repository checkout failed: ${messageOf(err)}`, branchName);
    }

    await emit('APPLYING_PATCH');
    for (const patch of input.patches) {
      const absPath = join(checkout.workspacePath, patch.filePath);
      let currentContent: string;
      try {
        currentContent = await readFile(absPath, 'utf8');
      } catch {
        return failed('PATCH_APPLICATION_FAILED', `${patch.filePath}: file does not exist in the checked-out branch`, branchName);
      }
      if (currentContent !== patch.originalContent) {
        return failed(
          'PATCH_APPLICATION_FAILED',
          `${patch.filePath}: current content no longer matches the content validated in Phase 7`,
          branchName,
        );
      }
      await writeFile(absPath, patch.patchedContent, 'utf8');
    }

    const actualChangedFiles = await getChangedFiles(checkout.workspacePath, timeoutMs);
    const changedFileCheck = validateChangedFileSet(
      input.patches.map((p) => p.filePath),
      actualChangedFiles,
    );
    if (!changedFileCheck.valid) {
      return failed('PROMOTION_VALIDATION_FAILED', changedFileCheck.reasons.join('; '), branchName);
    }

    await emit('COMMITTING');
    let commitSha: string;
    try {
      commitSha = await commitAll(checkout.workspacePath, input.commitMessage, timeoutMs);
    } catch (err) {
      return failed('COMMIT_FAILED', messageOf(err), branchName);
    }

    await emit('PUSHING');
    try {
      await pushBranch(checkout.workspacePath, branchName, input.accessToken, timeoutMs);
    } catch (err) {
      return failed('PUSH_FAILED', messageOf(err), branchName);
    }

    await emit('CREATING_PULL_REQUEST');
    try {
      const pr = await options.client.createPullRequest(input.owner, input.repo, {
        title: input.prTitle,
        body: input.prBody,
        head: branchName,
        base: input.defaultBranch,
      });
      return {
        status: 'CREATED',
        errorCode: null,
        errorMessage: null,
        branchName,
        commitSha,
        prNumber: pr.number,
        prUrl: pr.htmlUrl,
      };
    } catch (err) {
      if (err instanceof GitHubClientError && err.code === 'RATE_LIMITED') {
        return failed('GITHUB_RATE_LIMITED', 'GitHub API rate limit reached.', branchName);
      }
      const errorCode: PrPromotionErrorCode = err instanceof GitHubClientError ? 'GITHUB_API_FAILED' : 'PR_CREATION_FAILED';
      return failed(errorCode, messageOf(err), branchName);
    }
  } finally {
    if (checkout) await checkout.cleanup();
  }
}

async function getChangedFiles(workspacePath: string, timeoutMs: number): Promise<string[]> {
  const [diff, untracked] = await Promise.all([
    runGit(['diff', '--name-only'], { cwd: workspacePath, timeoutMs }),
    runGit(['ls-files', '--others', '--exclude-standard'], { cwd: workspacePath, timeoutMs }),
  ]);
  return [...diff.stdout.split('\n'), ...untracked.stdout.split('\n')].map((s) => s.trim()).filter(Boolean);
}

async function commitAll(workspacePath: string, message: string, timeoutMs: number): Promise<string> {
  const add = await runGit(['add', '-A'], { cwd: workspacePath, timeoutMs });
  if (add.exitCode !== 0) throw new Error(`git add failed: ${add.stderr.trim()}`);

  const commit = await runGit(
    ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '--quiet', '-m', message],
    { cwd: workspacePath, timeoutMs },
  );
  if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr.trim()}`);

  const revParse = await runGit(['rev-parse', 'HEAD'], { cwd: workspacePath, timeoutMs });
  if (revParse.exitCode !== 0 || !revParse.stdout.trim()) throw new Error(`git rev-parse failed: ${revParse.stderr.trim()}`);
  return revParse.stdout.trim();
}

async function pushBranch(workspacePath: string, branchName: string, accessToken: string | undefined, timeoutMs: number): Promise<void> {
  // Unlike `git clone -c ...` (clone has its own -c flag), `git push` has no such
  // subcommand option — the global `-c` must precede the subcommand entirely.
  const args: string[] = [];
  if (accessToken) args.push('-c', `http.extraHeader=Authorization: Bearer ${accessToken}`);
  args.push('push', '--quiet', 'origin', `HEAD:refs/heads/${branchName}`);

  const push = await runGit(args, { cwd: workspacePath, timeoutMs });
  if (push.exitCode !== 0) {
    throw new Error(`git push failed: ${sanitize(push.stderr, accessToken).trim()}`);
  }
}

function sanitize(text: string, token?: string): string {
  return token ? text.split(token).join('***') : text;
}

function messageOf(err: unknown): string {
  if (err instanceof PromotionCheckoutError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
