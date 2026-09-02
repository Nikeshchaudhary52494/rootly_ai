import { createHash } from 'node:crypto';

/** `sha256:<hex>` — a self-describing format so a stored hash never needs a separate algorithm field. */
export function computePatchHash(patch: string): string {
  return `sha256:${createHash('sha256').update(patch, 'utf8').digest('hex')}`;
}

/**
 * The trust boundary between Phase 7 (validation) and Phase 8 (promotion):
 * the exact bytes that passed sandbox validation must be the exact bytes
 * pushed to GitHub. A mismatch means `FixAttempt.patch` was mutated (or
 * corrupted) after validation — promotion must never proceed on that.
 */
export function verifyPatchIntegrity(patch: string, expectedHash: string): boolean {
  return computePatchHash(patch) === expectedHash;
}
