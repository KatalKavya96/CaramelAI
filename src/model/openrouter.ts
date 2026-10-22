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

function transportError(error: unknown): ModelTransportError {
  const status = statusCode(error);
  const message = error instanceof Error ? error.message : "OpenRouter request failed.";
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
        choices: Array<{ message?: { content?: unknown } }>;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      };
      const usage = result.usage === undefined ? undefined : {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      };
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
