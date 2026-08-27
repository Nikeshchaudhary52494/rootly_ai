import { badRequest } from './errors';
import { EnvironmentType } from './generated/prisma/client';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown>)?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest([`${field} should not be empty`, `${field} must be a string`]);
  }
  return value;
}

export function optionalString(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown>)?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string`);
  }
  return value;
}

export function requireSlug(body: unknown, field = 'slug'): string {
  const value = requireString(body, field);
  if (!SLUG_PATTERN.test(value)) {
    throw badRequest(`${field} must contain only lowercase letters, numbers, and hyphens`);
  }
  return value;
}

export function requireEnvironmentType(body: unknown): EnvironmentType {
  const value = (body as Record<string, unknown>)?.type;
  const allowed = Object.values(EnvironmentType);
  if (!allowed.includes(value as EnvironmentType)) {
    throw badRequest(`type must be one of the following values: ${allowed.join(', ')}`);
  }
  return value as EnvironmentType;
}
