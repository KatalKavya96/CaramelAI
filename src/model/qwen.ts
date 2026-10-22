import OpenAI from "openai";
import { ModelTransportError, retryAfterMs, StructuredModelAdapter, type ModelTransport } from "./adapter";
import type { ModelAdapter, ModelRequest } from "./types";

export const DEFAULT_QWEN_MODEL = "qwen-plus";
export const QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

interface QwenChatClient {
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
  const message = error instanceof Error ? error.message : "Qwen request failed.";
  if (status === 401 || status === 403) return new ModelTransportError("authentication", message, { cause: error });
  if (status === 429) return new ModelTransportError("rate_limit", message, { cause: error, retryAfterMs: retryAfterMs(error) });
  if (status !== undefined && status >= 400 && status < 500) return new ModelTransportError("permanent", message, { cause: error });
  return new ModelTransportError("transient", message, { cause: error });
}

function textContent(content: unknown): string {
  if (typeof content === "string" && content.trim() !== "") return content;
  throw new ModelTransportError("transient", "Qwen returned no text content.");
}

export class QwenTransport implements ModelTransport {
  constructor(
    private readonly client: QwenChatClient,
    private readonly model: string,
  ) {}

  async send(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        response_format: { type: "json_object" },
        temperature: 0,
        stream: false,
      }, { signal });
      if (typeof response !== "object" || response === null || !("choices" in response)) {
        throw new ModelTransportError("permanent", "Qwen returned an invalid chat response.");
      }
      const result = response as {
        choices: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const promptTokens = result.usage?.prompt_tokens;
      const completionTokens = result.usage?.completion_tokens;
      const totalTokens = result.usage?.total_tokens;
      const usage = promptTokens === undefined || completionTokens === undefined || totalTokens === undefined
        ? undefined
        : { inputTokens: promptTokens, outputTokens: completionTokens, totalTokens };
      return { output: textContent(result.choices[0]?.message?.content), usage };
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      throw transportError(error);
    }
  }
}

export function createQwenModel(options: {
  apiKey: string;
  model?: string;
  client?: QwenChatClient;
}): ModelAdapter {
  const client = options.client ?? (new OpenAI({
    apiKey: options.apiKey,
    baseURL: QWEN_BASE_URL,
    maxRetries: 0,
  }) as unknown as QwenChatClient);
  return new StructuredModelAdapter(
    new QwenTransport(client, options.model ?? DEFAULT_QWEN_MODEL),
    { requestTimeoutMs: 120_000, maxAttempts: 3 },
  );
}
