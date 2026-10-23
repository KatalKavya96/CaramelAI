import OpenAI from "openai";
import { ModelTransportError, retryAfterMs, StructuredModelAdapter, type ModelTransport } from "./adapter";
import { MODEL_DECISION_SCHEMA } from "./openrouter";
import type { ModelAdapter, ModelRequest } from "./types";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-5.2";
export const DEFAULT_XAI_MODEL = "grok-4";

interface ChatCompletionsClient {
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

/**
 * Chat Completions as OpenAI defines it, which xAI (Grok) also serves. One transport for both,
 * so a fix to error mapping or usage parsing lands for every provider that speaks this API.
 */
export class OpenAICompatibleTransport implements ModelTransport {
  /** Set once a server rejects json_schema; later calls ask for plain JSON instead. */
  private jsonObjectOnly = false;

  constructor(
    private readonly client: ChatCompletionsClient,
    private readonly model: string,
    private readonly providerName: string,
  ) {}

  async send(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
    try {
      const format = request.responseFormat ?? {
        name: "caramel_model_decision",
        description: "Exactly one validated coding-harness action.",
        schema: MODEL_DECISION_SCHEMA,
      };
      const send = () => this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        // Non-strict: strict mode needs every field required, and the decision schema has optional
        // fields. The schema still guides the model; the zod parser stays the real gate.
        response_format: this.jsonObjectOnly
          ? { type: "json_object" }
          : { type: "json_schema", json_schema: { name: format.name, description: format.description, schema: format.schema, strict: false } },
        stream: false,
      }, { signal });
      // No temperature: reasoning models on both APIs reject anything but the default.
      let response: unknown;
      try {
        response = await send();
      } catch (error) {
        // Some OpenAI-compatible servers (older local runtimes) only know json_object.
        const message = error instanceof Error ? error.message : "";
        if (this.jsonObjectOnly || statusCode(error) !== 400 || !/response_format|json_schema/i.test(message)) throw error;
        this.jsonObjectOnly = true;
        response = await send();
      }
      if (typeof response !== "object" || response === null || !("choices" in response)) {
        throw new ModelTransportError("permanent", `${this.providerName} returned an invalid chat response.`);
      }
      const result = response as {
        choices: Array<{ message?: { content?: unknown } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number } | null;
        };
      };
      const promptTokens = result.usage?.prompt_tokens;
      const completionTokens = result.usage?.completion_tokens;
      const totalTokens = result.usage?.total_tokens;
      const usage = promptTokens === undefined || completionTokens === undefined || totalTokens === undefined
        ? undefined
        : {
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            totalTokens,
            cachedInputTokens: result.usage?.prompt_tokens_details?.cached_tokens,
          };
      const content = result.choices[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new ModelTransportError("transient", `${this.providerName} returned no text content.`);
      }
      return { output: content, usage };
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      const status = statusCode(error);
      const message = error instanceof Error ? error.message : `${this.providerName} request failed.`;
      if (status === 401 || status === 403) throw new ModelTransportError("authentication", message, { cause: error });
      if (status === 429) throw new ModelTransportError("rate_limit", message, { cause: error, retryAfterMs: retryAfterMs(error) });
      if (status !== undefined && status >= 400 && status < 500) throw new ModelTransportError("permanent", message, { cause: error });
      throw new ModelTransportError("transient", message, { cause: error });
    }
  }
}

function createCompatibleModel(
  options: { apiKey: string; model?: string; client?: ChatCompletionsClient },
  baseURL: string,
  defaultModel: string,
  providerName: string,
  requestTimeoutMs = 120_000,
): ModelAdapter {
  const client = options.client ?? (new OpenAI({ apiKey: options.apiKey, baseURL, maxRetries: 0 }) as unknown as ChatCompletionsClient);
  return new StructuredModelAdapter(
    new OpenAICompatibleTransport(client, options.model ?? defaultModel, providerName),
    { requestTimeoutMs, maxAttempts: 3 },
  );
}

export function createOpenAIModel(options: { apiKey: string; model?: string; client?: ChatCompletionsClient }): ModelAdapter {
  return createCompatibleModel(options, OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL, "OpenAI");
}

export function createXaiModel(options: { apiKey: string; model?: string; client?: ChatCompletionsClient }): ModelAdapter {
  return createCompatibleModel(options, XAI_BASE_URL, DEFAULT_XAI_MODEL, "xAI");
}

/**
 * Any server that speaks OpenAI's Chat Completions API: Ollama, LM Studio, vLLM, Groq, Together
 * and most new labs. Local models can be slow on a laptop, so calls get a longer timeout.
 */
export function createCustomModel(options: { apiKey: string; baseUrl: string; model: string; client?: ChatCompletionsClient }): ModelAdapter {
  return createCompatibleModel(options, options.baseUrl, options.model, "Custom endpoint", 300_000);
}
