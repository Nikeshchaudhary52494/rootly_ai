import { createHash } from 'node:crypto';
import { normalizeErrorMessage } from './message-normalizer';
import { extractRelevantStackFrames } from './stack-normalizer';

const TITLE_MAX_LENGTH = 200;

/** Deterministic SHA-256 fingerprint from error name + normalized message + top stack frames. */
export function generateFingerprint(errorName: string, errorMessage: string, stackTrace?: string): string {
  const normalizedMessage = normalizeErrorMessage(errorMessage);
  const frames = extractRelevantStackFrames(stackTrace);
  const canonical = [errorName, normalizedMessage, ...frames].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export function generateIncidentTitle(errorName: string, errorMessage: string): string {
  const title = `${errorName}: ${errorMessage}`;
  return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 3)}...` : title;
}
