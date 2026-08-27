import type { NormalizedError } from '../types';

export function normalizeError(input: unknown): NormalizedError {
  if (input instanceof Error) {
    return {
      name: input.name || 'Error',
      message: input.message || 'Unknown error',
      stack: input.stack,
    };
  }

  if (typeof input === 'string') {
    return { name: 'Error', message: input };
  }

  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : typeof obj.code === 'string' ? obj.code : 'Error';
    const message = typeof obj.message === 'string' ? obj.message : safeStringify(obj);
    const stack = typeof obj.stack === 'string' ? obj.stack : undefined;
    return { name, message, stack };
  }

  return { name: 'Error', message: String(input) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unserializable error value';
  }
}
