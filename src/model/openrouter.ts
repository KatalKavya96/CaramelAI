import { OpenRouter } from "@openrouter/sdk";
import { ModelTransportError, retryAfterMs, StructuredModelAdapter, type ModelTransport } from "./adapter";
import { modelDecisionJsonSchema } from "./schema";
import type { ModelAdapter, ModelRequest, ResponseFormat } from "./types";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.2";

// Generated from the zod schema the parser uses, so the contract sent to the provider cannot drift.
// Strict structured output (OpenAI-style) requires every property to be required and rejects oneOf;
// this schema has optional fields, so it is sent non-strict and the parser stays the real gate.
export const MODEL_DECISION_SCHEMA = modelDecisionJsonSchema();

const DECISION_RESPONSE_FORMAT: ResponseFormat = {
  name: "dinner_model_decision",
  description: "Exactly one validated coding-harness action.",
  schema: MODEL_DECISION_SCHEMA,
};

interface OpenRouterChatClient {
  chat: {
    send(request: unknown, options?: { signal?: AbortSignal; retries?: { strategy: "none" } }): Promise<unknown>;
  };
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

const DETAIL_LIMIT = 400;

/**
 * OpenRouter's own message is often just "Provider returned error"; what went wrong is in
 * error.metadata: which upstream provider answered, and its raw reply (an unsupported
 * response_format, a data-policy block, an outage). Without it a failed run says nothing useful.
 */
export function describeOpenRouterError(payload: unknown, fallback: string): string {
  let body = payload;
  if (typeof payload === "string") {
    try {
      body = JSON.parse(payload);
    } catch {
      return payload.trim() === "" ? fallback : `${fallback}: ${payload.trim().slice(0, DETAIL_LIMIT)}`;
    }
  }
  const error = (body as { error?: unknown } | null)?.error ?? body;
  if (typeof error !== "object" || error === null) return fallback;
  const { message, code, metadata } = error as { message?: unknown; code?: unknown; metadata?: { raw?: unknown; provider_name?: unknown } | null };
  const parts = [typeof message === "string" && message !== "" ? message : fallback];
  const context = [
    typeof code === "number" || typeof code === "string" ? `code ${code}` : null,
    typeof metadata?.provider_name === "string" ? `provider ${metadata.provider_name}` : null,
  ].filter((part) => part !== null);
  if (context.length > 0) parts.push(`(${context.join(", ")})`);
  const raw = metadata?.raw;
  if (raw !== undefined && raw !== null && raw !== "") {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    parts.push(`: ${text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text}`);
  }
  return parts.join(" ").replace(" :", ":");
}

function transportError(error: unknown): ModelTransportError {
  const status = statusCode(error);
  const base = error instanceof Error ? error.message : "OpenRouter request failed.";
  const body = typeof error === "object" && error !== null ? (error as { body?: unknown }).body : undefined;
  const message = body === undefined ? base : describeOpenRouterError(body, base);
  if (status === 401 || status === 403) return new ModelTransportError("authentication", message, { cause: error });
  if (status === 429) return new ModelTransportError("rate_limit", message, { cause: error, retryAfterMs: retryAfterMs(error) });
  if (status !== undefined && status >= 400 && status < 500) return new ModelTransportError("permanent", message, { cause: error });
  return new ModelTransportError("transient", message, { cause: error });
}

function textContent(content: unknown): string {
  if (typeof content === "string" && content.trim() !== "") return content;
  throw new ModelTransportError("transient", "OpenRouter returned no text content.");
}

export class OpenRouterTransport implements ModelTransport {
  constructor(
    private readonly client: OpenRouterChatClient,
    private readonly model: string,
  ) {}

  async send(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.client.chat.send({
        chatRequest: {
          model: this.model,
          messages: request.messages.map(({ role, content }) => ({ role, content })),
          responseFormat: {
            type: "json_schema",
            jsonSchema: { ...(request.responseFormat ?? DECISION_RESPONSE_FORMAT), strict: false },
          },
          stream: false,
          temperature: 0,
        },
        appTitle: "Dinner AI Coding Harness",
        appCategories: "cli-agent",
      }, { signal, retries: { strategy: "none" } });
      if (typeof response !== "object" || response === null || !("choices" in response)) {
        throw new ModelTransportError("permanent", "OpenRouter returned an invalid chat response.");
      }
      const result = response as {
        choices: Array<{ message?: { content?: unknown }; error?: unknown }>;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          cost?: number | null;
          promptTokensDetails?: { cachedTokens?: number } | null;
        };
      };
      const usage = result.usage === undefined ? undefined : {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        // OpenRouter reports the charge itself, so cost needs no price table that could go stale.
        cachedInputTokens: result.usage.promptTokensDetails?.cachedTokens,
        costUsd: result.usage.cost,
      };
      // A provider can fail after OpenRouter accepted the request: the error then rides in the choice.
      const choiceError = result.choices[0]?.error;
      if (choiceError !== undefined && choiceError !== null) {
        throw new ModelTransportError("transient", describeOpenRouterError({ error: choiceError }, "Provider returned error"));
      }
      return { output: textContent(result.choices[0]?.message?.content), usage };
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      throw transportError(error);
    }
  }
}

export function createOpenRouterModel(options: {
  apiKey: string;
  model?: string;
  client?: OpenRouterChatClient;
}): ModelAdapter {
  const client = options.client ?? new OpenRouter({
    apiKey: options.apiKey,
    retryConfig: { strategy: "none" },
  });
  return new StructuredModelAdapter(new OpenRouterTransport(client, options.model ?? DEFAULT_OPENROUTER_MODEL));
}
