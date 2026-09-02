import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ZodType } from 'zod';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StructuredLLMRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  schemaName: string;
}

export interface StructuredLLMResponse {
  /** Unvalidated — callers must run it through their own schema check (see structured-output.ts). */
  raw: unknown;
  usage: LLMUsage;
}

/**
 * The only interface the graph nodes depend on. Keeps every OpenAI-specific
 * detail (client construction, request/response shape, token accounting)
 * behind this one seam so nodes and tests never touch the SDK directly.
 */
export interface InvestigationLLM {
  generateStructured<T>(request: StructuredLLMRequest<T>): Promise<StructuredLLMResponse>;
}

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class OpenAIInvestigationLLM implements InvestigationLLM {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: { apiKey: string; model: string }) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model;
  }

  async generateStructured<T>(request: StructuredLLMRequest<T>): Promise<StructuredLLMResponse> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: zodResponseFormat(request.schema, request.schemaName),
    });

    const choice = completion.choices[0];
    if (choice?.message.refusal) {
      throw new Error(`Model refused to respond: ${choice.message.refusal}`);
    }
    if (choice?.message.parsed === null || choice?.message.parsed === undefined) {
      throw new Error('Model returned no parsable structured output');
    }

    const usage = completion.usage;
    return {
      raw: choice.message.parsed,
      usage: usage
        ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens }
        : ZERO_USAGE,
    };
  }
}
