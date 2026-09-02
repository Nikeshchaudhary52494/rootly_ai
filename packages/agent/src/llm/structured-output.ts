import type { ZodType } from 'zod';
import type { InvestigationLLM, LLMUsage, StructuredLLMRequest } from './llm.client';

export class StructuredOutputError extends Error {}

export interface ValidatedResult<T> {
  data: T;
  usage: LLMUsage;
}

const EMPTY_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function sumUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Calls the LLM and validates its response against `schema`. On a schema
 * failure (or a thrown error from the client itself), retries exactly once
 * with a correction prompt appended. A second failure surfaces as
 * StructuredOutputError for the caller to turn into an investigation FAILED.
 */
export async function generateValidated<T>(
  llm: InvestigationLLM,
  request: StructuredLLMRequest<T>,
): Promise<ValidatedResult<T>> {
  const attempt = await tryOnce(llm, request);
  if (attempt.ok) return { data: attempt.data, usage: attempt.usage };

  const retryRequest: StructuredLLMRequest<T> = {
    ...request,
    user: `${request.user}\n\n---\nYour previous response was invalid: ${attempt.reason}\nReturn output that strictly matches the required schema. Do not include any commentary outside the schema fields.`,
  };
  const retry = await tryOnce(llm, retryRequest);
  const usage = sumUsage(attempt.usage, retry.usage);
  if (retry.ok) return { data: retry.data, usage };

  throw new StructuredOutputError(`Structured output validation failed after retry: ${retry.reason}`);
}

type Attempt<T> = { ok: true; data: T; usage: LLMUsage } | { ok: false; reason: string; usage: LLMUsage };

async function tryOnce<T>(llm: InvestigationLLM, request: StructuredLLMRequest<T>): Promise<Attempt<T>> {
  try {
    const response = await llm.generateStructured(request);
    const parsed = (request.schema as ZodType<T>).safeParse(response.raw);
    if (!parsed.success) {
      return { ok: false, reason: parsed.error.message, usage: response.usage };
    }
    return { ok: true, data: parsed.data, usage: response.usage };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), usage: EMPTY_USAGE };
  }
}
