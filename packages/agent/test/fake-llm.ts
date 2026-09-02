import type { InvestigationLLM, LLMUsage, StructuredLLMRequest, StructuredLLMResponse } from '../src/llm/llm.client';

const DEFAULT_USAGE: LLMUsage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };

type QueuedResponse = { raw: () => unknown; usage?: LLMUsage } | { error: string };

/**
 * A scriptable InvestigationLLM test double. Queue one response per expected
 * call (in call order); each generateStructured() call consumes the next one.
 */
export class FakeLLM implements InvestigationLLM {
  private queue: QueuedResponse[] = [];
  public calls: StructuredLLMRequest<unknown>[] = [];

  enqueueValid(raw: () => unknown, usage: LLMUsage = DEFAULT_USAGE) {
    this.queue.push({ raw, usage });
    return this;
  }

  enqueueError(message: string) {
    this.queue.push({ error: message });
    return this;
  }

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<StructuredLLMResponse> {
    this.calls.push(request as StructuredLLMRequest<unknown>);
    const next = this.queue.shift();
    if (!next) throw new Error(`FakeLLM: no queued response left for schema "${request.schemaName}"`);
    if ('error' in next) throw new Error(next.error);
    return { raw: next.raw(), usage: next.usage ?? DEFAULT_USAGE };
  }
}
