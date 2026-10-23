import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { claudeOutputSchema, createAnthropicModel, createOpenAIModel, createXaiModel, MODEL_DECISION_SCHEMA } from "../src/model";
import { createCustomModel } from "../src/model/openai-compatible";
import { credentialFromEnv, encodeCustomCredential, normalizeCustomBaseUrl, PROVIDER_INFO, PROVIDERS } from "../src/model/providers";
import { LOCAL_APP_POLICY, parseRunRequest, SHARED_SERVER_POLICY } from "../src/service";

const DECISION = JSON.stringify({ action: { type: "inspect_diff" } });

describe("provider registry", () => {
  test("every provider has a label, key link, default model and key test", () => {
    for (const provider of PROVIDERS) {
      const info = PROVIDER_INFO[provider];
      expect(info.id).toBe(provider);
      expect(info.keyUrl.startsWith("https://")).toBeTrue();
      // Custom endpoints have no sensible default model; runs must name one.
      expect(info.defaultModel.length > 0).toBe(provider !== "custom");
    }
    // Only OpenRouter reports the dollar cost; the others show tokens only.
    expect(PROVIDERS.filter((provider) => PROVIDER_INFO[provider].reportsCost)).toEqual(["openrouter"]);
  });

  test("runs accept the new providers", () => {
    for (const provider of ["anthropic", "openai", "xai"] as const) {
      expect(parseRunRequest({ task: "t", provider, repo: { kind: "local", path: "/tmp" } }, LOCAL_APP_POLICY).provider).toBe(provider);
    }
  });

  test("key tests map 401 to invalid_key and 200 to ok", async () => {
    const answering = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await PROVIDER_INFO.openai.testKey("sk-test", answering(401))).toMatchObject({ ok: false, error: "invalid_key" });
    expect(await PROVIDER_INFO.xai.testKey("xai-test", answering(200))).toEqual({ ok: true });
    expect(await PROVIDER_INFO.anthropic.testKey("sk-ant-test", answering(401))).toMatchObject({ ok: false, error: "invalid_key" });
    const models = (async () => Response.json({ data: [], has_more: false, first_id: null, last_id: null })) as unknown as typeof fetch;
    expect(await PROVIDER_INFO.anthropic.testKey("sk-ant-test", models)).toEqual({ ok: true });
  });
});

describe("Claude transport", () => {
  test("sends system separately with a structured-output schema and counts cache reads as input", async () => {
    let sent: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const model = createAnthropicModel({
      apiKey: "unused",
      client: {
        messages: {
          create: async (request) => {
            sent = request;
            return {
              content: [{ type: "text", text: DECISION }],
              stop_reason: "end_turn",
              usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
            } as unknown as Anthropic.Message;
          },
        },
      },
    });
    const turn = await model.complete({ messages: [{ role: "system", content: "rules" }, { role: "user", content: "go" }] });
    expect(turn.decision.action.type).toBe("inspect_diff");
    expect(turn.usage).toEqual({ source: "provider", inputTokens: 1000, outputTokens: 20, totalTokens: 1020, cachedInputTokens: 900 });
    expect(sent?.system).toBe("rules");
    expect(sent?.messages).toEqual([{ role: "user", content: "go" }]);
    expect(sent?.output_config?.format?.type).toBe("json_schema");
    expect("temperature" in (sent ?? {})).toBeFalse();
  });

  test("a refusal is a permanent error, not a retry loop", async () => {
    const model = createAnthropicModel({
      apiKey: "unused",
      client: { messages: { create: async () => ({ content: [], stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 0 } }) as unknown as Anthropic.Message } },
    });
    await expect(model.complete({ messages: [{ role: "user", content: "go" }] })).rejects.toMatchObject({ kind: "transport", retryable: false });
  });

  test("the output schema closes every object and drops unsupported keywords, but keeps property names", () => {
    const schema = claudeOutputSchema(MODEL_DECISION_SCHEMA) as Record<string, unknown>;
    const text = JSON.stringify(schema);
    expect(text).not.toContain('"maximum"');
    expect(text).not.toContain('"exclusiveMinimum"');
    expect(text).not.toContain('"$schema"');
    expect(schema.additionalProperties).toBe(false);
    // "path" and "content" are property names in the decision schema, not keywords.
    expect(text).toContain('"path"');
    expect(text).toContain('"content"');
  });
});

describe("OpenAI-compatible transport (GPT, Grok)", () => {
  test("sends a JSON schema without temperature and reads cached tokens", async () => {
    for (const create of [createOpenAIModel, createXaiModel]) {
      let sent: Record<string, unknown> | undefined;
      const model = create({
        apiKey: "unused",
        client: {
          chat: {
            completions: {
              create: async (request: unknown) => {
                sent = request as Record<string, unknown>;
                return {
                  choices: [{ message: { content: DECISION } }],
                  usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, prompt_tokens_details: { cached_tokens: 30 } },
                };
              },
            },
          },
        },
      });
      const turn = await model.complete({ messages: [{ role: "user", content: "go" }] });
      expect(turn.usage).toEqual({ source: "provider", inputTokens: 50, outputTokens: 5, totalTokens: 55, cachedInputTokens: 30 });
      expect((sent?.response_format as { type: string }).type).toBe("json_schema");
      expect("temperature" in (sent ?? {})).toBeFalse();
    }
  });
});

describe("custom OpenAI-compatible endpoint", () => {
  test("accepts https anywhere and plain http only for this machine", () => {
    expect(normalizeCustomBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(normalizeCustomBaseUrl("https://api.groq.com/openai/v1")).toBe("https://api.groq.com/openai/v1");
    expect(() => normalizeCustomBaseUrl("http://192.168.1.20:11434/v1")).toThrow("https");
    expect(() => normalizeCustomBaseUrl("https://user:pass@example.com/v1")).toThrow("key field");
    expect(() => normalizeCustomBaseUrl("localhost:11434")).toThrow();
  });

  test("the CLI builds the credential from CUSTOM_BASE_URL, and a key is optional", () => {
    expect(JSON.parse(credentialFromEnv("custom", { CUSTOM_BASE_URL: "http://127.0.0.1:1234/v1" })!)).toEqual({ baseUrl: "http://127.0.0.1:1234/v1", apiKey: "not-needed" });
    expect(credentialFromEnv("custom", {})).toBeUndefined();
  });

  test("the key test lists models at the base URL and explains a wrong path", async () => {
    const seen: string[] = [];
    const answering = (status: number) => (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response("{}", { status });
    }) as unknown as typeof fetch;
    const credential = encodeCustomCredential({ baseUrl: "http://localhost:11434/v1" });
    expect(await PROVIDER_INFO.custom.testKey(credential, answering(200))).toEqual({ ok: true });
    expect(seen).toEqual(["http://localhost:11434/v1/models Bearer not-needed"]);
    expect(await PROVIDER_INFO.custom.testKey(credential, answering(404))).toMatchObject({ ok: false, message: expect.stringContaining("/v1") });
  });

  test("runs need a model, and a shared server refuses custom endpoints", () => {
    const request = { task: "t", provider: "custom", repo: { kind: "local", path: "/tmp" } };
    expect(() => parseRunRequest(request, LOCAL_APP_POLICY)).toThrow("model");
    expect(parseRunRequest({ ...request, model: "llama3.1" }, LOCAL_APP_POLICY).model).toBe("llama3.1");
    expect(() => parseRunRequest({ ...request, model: "llama3.1", repo: { kind: "git", url: "https://github.com/a/b" } }, SHARED_SERVER_POLICY))
      .toThrow("desktop app");
    expect(() => PROVIDER_INFO.custom.create({ apiKey: encodeCustomCredential({ baseUrl: "http://localhost:11434/v1" }) })).toThrow("model");
  });

  test("falls back to plain JSON when a server rejects json_schema", async () => {
    const formats: string[] = [];
    const model = createCustomModel({
      apiKey: "unused",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1",
      client: {
        chat: {
          completions: {
            create: async (request: unknown) => {
              const type = (request as { response_format: { type: string } }).response_format.type;
              formats.push(type);
              if (type === "json_schema") throw Object.assign(new Error("unsupported response_format type json_schema"), { status: 400 });
              return { choices: [{ message: { content: DECISION } }] };
            },
          },
        },
      },
    });
    expect((await model.complete({ messages: [{ role: "user", content: "go" }] })).decision.action.type).toBe("inspect_diff");
    await model.complete({ messages: [{ role: "user", content: "again" }] });
    // Once the server has said no, later calls go straight to json_object.
    expect(formats).toEqual(["json_schema", "json_object", "json_object"]);
  });
});
