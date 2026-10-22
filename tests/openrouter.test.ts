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

describe("OpenRouter rate limits", () => {
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
});
