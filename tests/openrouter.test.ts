import { describe, expect, test } from "bun:test";
import { createOpenRouterModel, MODEL_DECISION_SCHEMA } from "../src/model";

describe("OpenRouter model transport", () => {
  test("sends the generated decision schema as structured output and maps content and usage", async () => {
    let request: any;
    let options: any;
    const model = createOpenRouterModel({
      apiKey: "not-forwarded",
      model: "openai/test-model",
      client: {
        chat: {
          async send(nextRequest, nextOptions) {
            request = nextRequest;
            options = nextOptions;
            return {
              choices: [{ message: { content: JSON.stringify({ action: { type: "inspect_diff" } }) } }],
              usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
            };
          },
        },
      },
    });

    const turn = await model.complete({ messages: [{ role: "user", content: "Inspect it" }] });

    expect(turn).toEqual({
      decision: { action: { type: "inspect_diff" } },
      usage: { source: "provider", inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    expect(request.chatRequest).toMatchObject({
      model: "openai/test-model",
      stream: false,
      temperature: 0,
      responseFormat: { type: "json_schema", jsonSchema: { name: "dinner_model_decision", strict: false } },
    });
    expect(request.chatRequest.responseFormat.jsonSchema.schema).toEqual(MODEL_DECISION_SCHEMA);
    expect(options.retries).toEqual({ strategy: "none" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(request)).not.toContain("not-forwarded");
  });

  test("maps authentication errors without retrying", async () => {
    let calls = 0;
    const model = createOpenRouterModel({
      apiKey: "secret",
      client: {
        chat: {
          async send() {
            calls += 1;
            throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
          },
        },
      },
    });

    await expect(model.complete({ messages: [] })).rejects.toMatchObject({
      kind: "authentication",
      retryable: false,
      attempts: 1,
    });
    expect(calls).toBe(1);
  });

  test("treats empty provider content as retryable", async () => {
    let calls = 0;
    const model = createOpenRouterModel({
      apiKey: "secret",
      client: {
        chat: {
          async send() {
            calls += 1;
            return { choices: [{ message: { content: null } }] };
          },
        },
      },
    });

    await expect(model.complete({ messages: [] })).rejects.toMatchObject({
      kind: "transport",
      retryable: true,
      attempts: 3,
    });
    expect(calls).toBe(3);
  });
});

describe("OpenRouter error detail", () => {
  test("keeps the upstream provider and its raw reply, not just \"Provider returned error\"", async () => {
    const { OpenRouterTransport } = await import("../src/model");
    const body = JSON.stringify({ error: { message: "Provider returned error", code: 400, metadata: { provider_name: "Poolside", raw: "{\"error\":\"response_format json_schema is not supported\"}" } } });
    const failed = Object.assign(new Error("Provider returned error"), { statusCode: 400, body });
    const transport = new OpenRouterTransport({ chat: { send: async () => { throw failed; } } }, "m");
    const error: any = await transport.send({ messages: [] }, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error.kind).toBe("permanent");
    expect(error.message).toBe('Provider returned error (code 400, provider Poolside): {"error":"response_format json_schema is not supported"}');
  });

  test("reads an error that arrives inside a 200 response's choice", async () => {
    const { OpenRouterTransport } = await import("../src/model");
    const transport = new OpenRouterTransport({
      chat: { send: async () => ({ choices: [{ message: { content: "" }, error: { message: "Upstream timed out", code: 502, metadata: { provider_name: "Flint" } } }] }) },
    }, "m");
    const error: any = await transport.send({ messages: [] }, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error.kind).toBe("transient");
    expect(error.message).toBe("Upstream timed out (code 502, provider Flint)");
  });

  test("falls back to the SDK's message when the body is not JSON", async () => {
    const { describeOpenRouterError } = await import("../src/model/openrouter");
    expect(describeOpenRouterError("", "Bad gateway")).toBe("Bad gateway");
    expect(describeOpenRouterError("upstream exploded", "Bad gateway")).toBe("Bad gateway: upstream exploded");
  });
});

describe("OpenRouter rate limits", () => {
  test("a free model's upstream 429 inside \"Provider returned error\" is a rate limit, with the reason kept", async () => {
    const { OpenRouterTransport } = await import("../src/model");
    const body = JSON.stringify({ error: { message: "Provider returned error", code: 429, metadata: { raw: "poolside/laguna-s-2.1:free is temporarily rate-limited upstream.", provider_name: "Poolside" } } });
    // No HTTP status on the error: the code exists only in the body.
    const failed = Object.assign(new Error("Provider returned error"), { body });
    const transport = new OpenRouterTransport({ chat: { send: async () => { throw failed; } } }, "m");
    const error: any = await transport.send({ messages: [] }, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error.kind).toBe("rate_limit");
    expect(error.message).toBe("Provider returned error (code 429, provider Poolside): poolside/laguna-s-2.1:free is temporarily rate-limited upstream.");
  });

  test("carries the provider's Retry-After into the retry delay", async () => {
    const { OpenRouterTransport, ModelTransportError } = await import("../src/model");
    const rateLimited = Object.assign(new Error("Too many requests"), {
      statusCode: 429,
      headers: new Headers({ "retry-after": "4" }),
    });
    const transport = new OpenRouterTransport({ chat: { send: async () => { throw rateLimited; } } }, "m");
    const error: any = await transport.send({ messages: [] }, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelTransportError);
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterMs).toBe(4_000);
  });

  test("passes through the cost and cache hits OpenRouter reports", async () => {
    const model = createOpenRouterModel({
      apiKey: "not-forwarded",
      client: {
        chat: {
          send: async () => ({
            choices: [{ message: { content: JSON.stringify({ action: { type: "inspect_diff" } }) } }],
            usage: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050, cost: 0.0021, promptTokensDetails: { cachedTokens: 800 } },
          }),
        },
      },
    });
    const turn = await model.complete({ messages: [{ role: "user", content: "Inspect it" }] });
    expect(turn.usage).toEqual({ source: "provider", inputTokens: 1000, outputTokens: 50, totalTokens: 1050, cachedInputTokens: 800, costUsd: 0.0021 });
  });
});
