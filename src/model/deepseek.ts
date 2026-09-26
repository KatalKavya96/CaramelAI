import OpenAI from "openai";
import { ModelTransportError, StructuredModelAdapter, type ModelTransport } from "./adapter";
import type { ModelAdapter, ModelRequest } from "./types";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export type DeepSeekReasoningEffort = "low" | "medium" | "high";

interface DeepSeekChatClient {
  chat: {
    completions: {
      create(request: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
    };
  };
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

function transportError(error: unknown): ModelTransportError {
  const status = statusCode(error);
  const message = error instanceof Error ? error.message : "DeepSeek request failed.";
  if (status === 401 || status === 403) {
    return new ModelTransportError("authentication", message, { cause: error });
  }
  if (status === 429) return new ModelTransportError("rate_limit", message, { cause: error });
  if (status !== undefined && status >= 400 && status < 500) {
    return new ModelTransportError("permanent", message, { cause: error });
  }
  return new ModelTransportError("transient", message, { cause: error });
}

function textContent(content: unknown): string {
  if (typeof content === "string" && content.trim() !== "") return content;
  throw new ModelTransportError("transient", "DeepSeek returned no text content.");
}

export class DeepSeekTransport implements ModelTransport {
  constructor(
    private readonly client: DeepSeekChatClient,
    private readonly model: string,
    private readonly reasoningEffort: DeepSeekReasoningEffort,
  ) {}

  async send(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        thinking: { type: "enabled" },
        reasoning_effort: this.reasoningEffort,
        response_format: { type: "json_object" },
        temperature: 0.0,
        stream: false,
      }, { signal });
      if (typeof response !== "object" || response === null || !("choices" in response)) {
        throw new ModelTransportError("permanent", "DeepSeek returned an invalid chat response.");
      }
      const result = response as {
        choices: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const promptTokens = result.usage?.prompt_tokens;
      const completionTokens = result.usage?.completion_tokens;
      const totalTokens = result.usage?.total_tokens;
      const usage = promptTokens === undefined || completionTokens === undefined || totalTokens === undefined
        ? undefined
        : { inputTokens: promptTokens, outputTokens: completionTokens, totalTokens };
      const message = result.choices[0]?.message;
      const content = message?.content;
      return { output: textContent(content), usage };
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      throw transportError(error);
    }
  }
}

export function createDeepSeekModel(options: {
  apiKey: string;
  model?: string;
  reasoningEffort?: DeepSeekReasoningEffort;
  client?: DeepSeekChatClient;
}): ModelAdapter {
  const client = options.client ?? (new OpenAI({
    apiKey: options.apiKey,
    baseURL: DEEPSEEK_BASE_URL,
    maxRetries: 0,
  }) as unknown as DeepSeekChatClient);
  return new StructuredModelAdapter(
    new DeepSeekTransport(
      client,
      options.model ?? DEFAULT_DEEPSEEK_MODEL,
      options.reasoningEffort ?? "medium",
    ),
    { requestTimeoutMs: 120_000, maxAttempts: 3 },
  );
}
