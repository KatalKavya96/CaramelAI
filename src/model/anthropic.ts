import Anthropic from "@anthropic-ai/sdk";
import { ModelTransportError, retryAfterMs, StructuredModelAdapter, type ModelTransport } from "./adapter";
import { MODEL_DECISION_SCHEMA } from "./openrouter";
import type { ModelAdapter, ModelRequest } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Keywords Claude's structured outputs reject; the zod parser still enforces them client-side. */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "default",
]);

/**
 * Structured outputs need `additionalProperties: false` on every object and accept a subset of
 * JSON Schema. Walks schema nodes only, so a property that happens to be called "pattern" or
 * "default" is kept.
 */
export function claudeOutputSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(claudeOutputSchema);
  if (typeof node !== "object" || node === null) return node;
  const schema: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "properties" && typeof value === "object" && value !== null) {
      schema.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, claudeOutputSchema(child)]));
    } else if (key === "items" || key === "anyOf" || key === "allOf" || key === "oneOf" || key === "$defs" || key === "definitions") {
      schema[key] = key === "$defs" || key === "definitions"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, claudeOutputSchema(child)]))
        : claudeOutputSchema(value);
    } else {
      schema[key] = value;
    }
  }
  if (schema.type === "object") schema.additionalProperties = false;
  return schema;
}

interface MessagesClient {
  messages: {
    create(request: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
  };
}

export class AnthropicTransport implements ModelTransport {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
  ) {}

  async send(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages: Anthropic.MessageParam[] = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16_000,
        ...(system === "" ? {} : { system }),
        messages,
        output_config: {
          format: { type: "json_schema", schema: claudeOutputSchema(request.responseFormat?.schema ?? MODEL_DECISION_SCHEMA) as Record<string, unknown> },
        },
      }, { signal });

      if (response.stop_reason === "refusal") {
        throw new ModelTransportError("permanent", "Claude declined this request.");
      }
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      if (text.trim() === "") throw new ModelTransportError("transient", "Claude returned no text content.");
      // input_tokens counts only uncached input; cache reads and writes are billed separately.
      const cached = response.usage.cache_read_input_tokens ?? 0;
      const inputTokens = response.usage.input_tokens + cached + (response.usage.cache_creation_input_tokens ?? 0);
      return {
        output: text,
        usage: {
          inputTokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: inputTokens + response.usage.output_tokens,
          cachedInputTokens: cached,
        },
      };
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ModelTransportError("authentication", error.message, { cause: error });
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ModelTransportError("rate_limit", error.message, { cause: error, retryAfterMs: retryAfterMs(error) });
      }
      if (error instanceof Anthropic.APIError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        throw new ModelTransportError("permanent", error.message, { cause: error });
      }
      const message = error instanceof Error ? error.message : "Claude request failed.";
      throw new ModelTransportError("transient", message, { cause: error });
    }
  }
}

export function createAnthropicModel(options: { apiKey: string; model?: string; client?: MessagesClient }): ModelAdapter {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
  return new StructuredModelAdapter(
    new AnthropicTransport(client, options.model ?? DEFAULT_ANTHROPIC_MODEL),
    { requestTimeoutMs: 180_000, maxAttempts: 3 },
  );
}
