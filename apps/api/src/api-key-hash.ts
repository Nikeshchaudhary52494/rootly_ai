import { createHash } from 'node:crypto';

export function hashApiKey(rawKey: string) {
  return createHash('sha256').update(rawKey).digest('hex');
}
