import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { createDeepSeekModel, DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL } from "./deepseek";
import {
  createCustomModel,
  createOpenAIModel,
  createXaiModel,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_XAI_MODEL,
  OPENAI_BASE_URL,
  XAI_BASE_URL,
} from "./openai-compatible";
import { createOpenRouterModel, DEFAULT_OPENROUTER_MODEL } from "./openrouter";
import { createQwenModel, DEFAULT_QWEN_MODEL, QWEN_BASE_URL } from "./qwen";
import type { ModelAdapter } from "./types";

export const PROVIDERS = ["openrouter", "anthropic", "openai", "xai", "deepseek", "qwen", "custom"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type KeyTestResult =
  | { ok: true }
  | { ok: false; error: "invalid_key" | "no_credit" | "rate_limited" | "provider_error"; message: string };

/** Everything the app needs to know about a provider, in one place, so adding one is one entry. */
export interface ProviderInfo {
  id: Provider;
  /** What the user sees in the provider picker. */
  label: string;
  /** Empty for "custom": there is no sensible default, so runs must name a model. */
  defaultModel: string;
  /** Environment variable the CLI reads the key from. */
  keyEnv: string;
  /** Where a user creates a key; shown next to the key field. */
  keyUrl: string;
  /** Whether replies carry the dollar cost. Otherwise the app shows tokens only, never a guess. */
  reportsCost: boolean;
  /** Can connect through a browser sign-in instead of a pasted key. */
  oauth: boolean;
  create(options: { apiKey: string; model?: string }): ModelAdapter;
  testKey(key: string, fetcher: typeof fetch): Promise<KeyTestResult>;
}

function failure(error: Exclude<KeyTestResult, { ok: true }>["error"], message: string): KeyTestResult {
  return { ok: false, error, message };
}

/** One cheap authenticated GET, mapped to the errors the setup screen shows. */
async function testWithGet(
  url: string,
  headers: Record<string, string>,
  fetcher: typeof fetch,
  check?: (body: unknown) => KeyTestResult | undefined,
): Promise<KeyTestResult> {
  let response: Response;
  try {
    response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return failure("provider_error", error instanceof Error ? error.message : String(error));
  }
  if (response.status === 401 || response.status === 403) return failure("invalid_key", "The provider rejected this key.");
  if (response.status === 402) return failure("no_credit", "This key has no credit left.");
  if (response.status === 429) return failure("rate_limited", "The provider is rate limiting this key; try again shortly.");
  if (!response.ok) return failure("provider_error", `The provider answered ${response.status}.`);
  return check?.(await response.json().catch(() => ({}))) ?? { ok: true };
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/** A custom endpoint is a base URL plus a key, stored together as one encrypted secret. */
export interface CustomEndpoint {
  baseUrl: string;
  apiKey: string;
  /** The model runs use unless they name another; saved with the endpoint because there is no default. */
  model?: string;
}

/** Local runtimes such as Ollama ignore the key, but the OpenAI client needs a non-empty one. */
export const NO_KEY = "not-needed";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * https anywhere, or plain http only to this machine: over http the key travels in clear text,
 * which is harmless for a local Ollama and a leak for anything on a network.
 */
export function normalizeCustomBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Base URL must be a full URL, such as http://localhost:11434/v1.");
  }
  if (url.username !== "" || url.password !== "") throw new Error("Put the key in the key field, not in the URL.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new Error("Base URL must use https, or http only for localhost.");
  }
  if (url.search !== "" || url.hash !== "") throw new Error("Base URL must not have a query string.");
  return url.toString().replace(/\/+$/, "");
}

export function encodeCustomCredential(endpoint: { baseUrl: string; apiKey?: string; model?: string }): string {
  const apiKey = endpoint.apiKey?.trim() || NO_KEY;
  const model = endpoint.model?.trim();
  if (model !== undefined && model.length > 200) throw new Error("Model name is too long.");
  return JSON.stringify({ baseUrl: normalizeCustomBaseUrl(endpoint.baseUrl), apiKey, ...(model ? { model } : {}) });
}

export function decodeCustomCredential(secret: string): CustomEndpoint {
  try {
    const value = JSON.parse(secret) as Partial<CustomEndpoint>;
    if (typeof value.baseUrl === "string" && typeof value.apiKey === "string") {
      return {
        baseUrl: normalizeCustomBaseUrl(value.baseUrl),
        apiKey: value.apiKey,
        ...(typeof value.model === "string" && value.model !== "" ? { model: value.model } : {}),
      };
    }
  } catch {
    // Falls through to the error below.
  }
  throw new Error("The custom endpoint is not set up: save a base URL first.");
}

/**
 * The credential the CLI and benchmark read from the environment. For "custom" it is built from
 * CUSTOM_BASE_URL and an optional CUSTOM_API_KEY; for the rest it is the key variable.
 */
export function credentialFromEnv(provider: Provider, env: Record<string, string | undefined>): string | undefined {
  if (provider !== "custom") return env[PROVIDER_INFO[provider].keyEnv]?.trim() || undefined;
  const baseUrl = env.CUSTOM_BASE_URL?.trim();
  if (baseUrl === undefined || baseUrl === "") return undefined;
  return encodeCustomCredential({
    baseUrl,
    ...(env.CUSTOM_API_KEY === undefined ? {} : { apiKey: env.CUSTOM_API_KEY }),
    ...(env.CUSTOM_MODEL === undefined ? {} : { model: env.CUSTOM_MODEL }),
  });
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (Claude, GPT, Grok, DeepSeek and more with one key)",
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    keyEnv: "AI_API_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
    reportsCost: true,
    oauth: true,
    create: (options) => createOpenRouterModel(options),
    testKey: (key, fetcher) => testWithGet("https://openrouter.ai/api/v1/key", bearer(key), fetcher, (body) => {
      const remaining = (body as { data?: { limit_remaining?: unknown } }).data?.limit_remaining;
      return typeof remaining === "number" && remaining <= 0 ? failure("no_credit", "This key has no credit left.") : undefined;
    }),
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    keyEnv: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    reportsCost: false,
    oauth: false,
    create: (options) => createAnthropicModel(options),
    // Listing models is free and needs a valid key, so it checks the key without spending anything.
    testKey: async (key, fetcher) => {
      try {
        await new Anthropic({ apiKey: key, fetch: fetcher, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 1 });
        return { ok: true };
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
          return failure("invalid_key", "Anthropic rejected this key.");
        }
        if (error instanceof Anthropic.RateLimitError) return failure("rate_limited", "Anthropic is rate limiting this key; try again shortly.");
        return failure("provider_error", error instanceof Error ? error.message : String(error));
      }
    },
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    defaultModel: DEFAULT_OPENAI_MODEL,
    keyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    reportsCost: false,
    oauth: false,
    create: (options) => createOpenAIModel(options),
    testKey: (key, fetcher) => testWithGet(`${OPENAI_BASE_URL}/models`, bearer(key), fetcher),
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    defaultModel: DEFAULT_XAI_MODEL,
    keyEnv: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
    reportsCost: false,
    oauth: false,
    create: (options) => createXaiModel(options),
    testKey: (key, fetcher) => testWithGet(`${XAI_BASE_URL}/models`, bearer(key), fetcher),
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: DEFAULT_DEEPSEEK_MODEL,
    keyEnv: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
    reportsCost: false,
    oauth: false,
    create: (options) => createDeepSeekModel(options),
    testKey: (key, fetcher) => testWithGet(`${DEEPSEEK_BASE_URL}/user/balance`, bearer(key), fetcher, (body) =>
      (body as { is_available?: unknown }).is_available === false ? failure("no_credit", "This key has no credit left.") : undefined),
  },
  qwen: {
    id: "qwen",
    label: "Qwen (Alibaba Cloud)",
    defaultModel: DEFAULT_QWEN_MODEL,
    keyEnv: "QWEN_API_KEY",
    keyUrl: "https://bailian.console.alibabacloud.com/?apiKey=1",
    reportsCost: false,
    oauth: false,
    create: (options) => createQwenModel(options),
    testKey: (key, fetcher) => testWithGet(`${QWEN_BASE_URL}/models`, bearer(key), fetcher),
  },
  custom: {
    id: "custom",
    label: "Custom endpoint (Ollama, LM Studio, Groq, Together or any OpenAI-compatible API)",
    defaultModel: "",
    keyEnv: "CUSTOM_API_KEY",
    keyUrl: "https://platform.openai.com/docs/api-reference/chat",
    reportsCost: false,
    oauth: false,
    create: (options) => {
      const endpoint = decodeCustomCredential(options.apiKey);
      const model = options.model?.trim() || endpoint.model;
      if (model === undefined) throw new Error("A custom endpoint needs a model name, such as llama3.1 or qwen2.5-coder.");
      return createCustomModel({ baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, model });
    },
    // Listing models is free on every OpenAI-compatible server and proves the URL and key work.
    testKey: async (key, fetcher) => {
      let endpoint: CustomEndpoint;
      try {
        endpoint = decodeCustomCredential(key);
      } catch (error) {
        return failure("provider_error", (error as Error).message);
      }
      const result = await testWithGet(`${endpoint.baseUrl}/models`, bearer(endpoint.apiKey), fetcher);
      if (!result.ok && result.message.includes("answered 404")) {
        return failure("provider_error", "Nothing answered at /models. The base URL usually ends in /v1.");
      }
      return result;
    },
  },
};

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
