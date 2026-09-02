import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from './git-utils';

export interface CheckoutOptions {
  /** e.g. https://github.com/owner/repo */
  repositoryUrl: string;
  /** A commit sha or a ref (e.g. a branch name) — always resolved to a concrete sha before returning. */
  commitSha: string;
  /** Decrypted token for a private repo — used only for this single clone, never persisted or logged. */
  accessToken?: string;
  timeoutMs?: number;
}

export interface CheckoutResult {
  /** Host temp dir containing the checked-out tree, with .git already stripped. */
  workspacePath: string;
  /** The concrete commit sha actually checked out — resolved even when `commitSha` was a branch name. */
  resolvedCommitSha: string;
  cleanup: () => Promise<void>;
}

export class RepositoryCheckoutError extends Error {}

function cloneArgs(repositoryUrl: string, dir: string, accessToken?: string): string[] {
  const args = ['clone', '--no-checkout', '--quiet'];
  if (accessToken) {
    // One-off header override: never written to .git/config, never becomes a persistent env var.
    args.push('-c', `http.extraHeader=Authorization: Bearer ${accessToken}`);
  }
  args.push(repositoryUrl, dir);
  return args;
}

/**
 * Clones on the host (cloning/checking out doesn't execute repository code —
 * the risky step is later, running application code inside the Docker
 * sandbox) and hands back a throwaway directory with .git removed so no
 * credential material or history travels any further than this step.
 */
export async function checkoutRepository(options: CheckoutOptions): Promise<CheckoutResult> {
  const dir = await mkdtemp(join(tmpdir(), 'incident-ai-reproduction-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });

  try {
    let clone = await runGit(cloneArgs(options.repositoryUrl, dir, options.accessToken), {
      timeoutMs: options.timeoutMs,
    });

    // A stored token can be stale, revoked, or simply unnecessary for what turns out to be a
    // public repo. Retrying anonymously only ever succeeds when the repo was reachable without
    // credentials anyway, so this can't grant access a correctly-scoped token wouldn't already
    // have — it just avoids a false checkout failure caused by a bad token on a public repo.
    if (clone.exitCode !== 0 && options.accessToken) {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      clone = await runGit(cloneArgs(options.repositoryUrl, dir, undefined), { timeoutMs: options.timeoutMs });
    }

    if (clone.exitCode !== 0) {
      throw new RepositoryCheckoutError(`git clone failed: ${sanitize(clone.stderr, options.accessToken)}`);
    }

    const checkout = await runGit(['checkout', '--quiet', options.commitSha], {
      cwd: dir,
      timeoutMs: options.timeoutMs,
    });
    if (checkout.exitCode !== 0) {
      throw new RepositoryCheckoutError(`git checkout failed: ${sanitize(checkout.stderr, options.accessToken)}`);
    }

    const revParse = await runGit(['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: options.timeoutMs });
    if (revParse.exitCode !== 0 || !revParse.stdout.trim()) {
      throw new RepositoryCheckoutError(`git rev-parse failed: ${sanitize(revParse.stderr, options.accessToken)}`);
    }
    const resolvedCommitSha = revParse.stdout.trim();

    await rm(join(dir, '.git'), { recursive: true, force: true });

    return { workspacePath: dir, resolvedCommitSha, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function sanitize(text: string, token?: string): string {
  return token ? text.split(token).join('***') : text;
}
