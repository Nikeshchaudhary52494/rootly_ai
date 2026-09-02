import { randomUUID } from 'node:crypto';
import { normalizeError } from '../utils/error-normalizer';
import type { ErrorEventPayload, RootlyAIConfig } from '../types';

export function buildErrorEvent(error: unknown, config: RootlyAIConfig): ErrorEventPayload {
  const normalized = normalizeError(error);

  return {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    service: {
      name: config.serviceName,
      environment: config.environment,
      release: config.release,
    },
    error: normalized,
  };
}
