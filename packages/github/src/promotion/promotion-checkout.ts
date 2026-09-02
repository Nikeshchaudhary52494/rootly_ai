import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from '@rootly.ai/reproduction';

export interface PromotionCheckoutOptions {
  repositoryUrl: string;
  /** A branch name or commit sha to check out. */
  ref: string;
  accessToken?: string;
  timeoutMs?: number;
}

export interface PromotionCheckoutResult {
  workspacePath: string;
  cleanup: () => Promise<void>;
}

export class PromotionCheckoutError extends Error {}

/**
 * GitHub's git-over-HTTPS smart protocol authenticates via Basic auth (token
 * as the password) — unlike the REST API, which accepts a Bearer header. A
 * PAT sent as `Authorization: Bearer` here gets a 401 from git's backend,
 * which then falls back to an interactive credential prompt instead of
 * surfacing a clean auth error.
 */
export function gitAuthHeader(accessToken: string): string {
  const basic = Buffer.from(`x-access-token:${accessToken}`).toString('base64');
  return `http.extraHeader=Authorization: Basic ${basic}`;
}

/**
 * Deliberately different from @rootly.ai/reproduction's checkoutRepository:
 * that one strips `.git` immediately because its checkout only ever needs to
 * be read and executed. This checkout exists specifically to commit and push
 * from, so `.git` has to stay. The credential is still only ever used as a
 * one-off `-c http.extraHeader` override on the two git subprocess calls
 * that need it (clone, and later push) — never written to `.git/config`,
 * never a persistent env var — and `cleanup()` deletes the whole workspace,
 * `.git` included, the moment the push has completed (success or failure).
 */
export async function checkoutForPromotion(options: PromotionCheckoutOptions): Promise<PromotionCheckoutResult> {
  const dir = await mkdtemp(join(tmpdir(), 'rootly.ai-promotion-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });

  try {
    const cloneArgs = ['clone', '--no-checkout', '--quiet'];
    if (options.accessToken) cloneArgs.push('-c', gitAuthHeader(options.accessToken));
    cloneArgs.push(options.repositoryUrl, dir);

    const clone = await runGit(cloneArgs, { timeoutMs: options.timeoutMs });
    if (clone.exitCode !== 0) {
      throw new PromotionCheckoutError(`git clone failed: ${sanitize(clone.stderr, options.accessToken)}`);
    }

    // `git clone -c` (unlike `-c` on other commands) writes that config into the
    // new repo's local .git/config. Left in place, push's own `-c http.extraHeader`
    // would stack on top of it and send GitHub two Authorization headers, which it
    // rejects outright — so strip it the moment clone no longer needs it.
    if (options.accessToken) {
      await runGit(['config', '--local', '--unset-all', 'http.extraHeader'], { cwd: dir, timeoutMs: options.timeoutMs });
    }

    const checkout = await runGit(['checkout', '--quiet', options.ref], { cwd: dir, timeoutMs: options.timeoutMs });
    if (checkout.exitCode !== 0) {
      throw new PromotionCheckoutError(`git checkout failed: ${sanitize(checkout.stderr, options.accessToken)}`);
    }

    return { workspacePath: dir, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function sanitize(text: string, token?: string): string {
  return token ? text.split(token).join('***') : text;
}
