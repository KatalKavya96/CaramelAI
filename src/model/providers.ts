import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { createDeepSeekModel, DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL } from "./deepseek";
import {
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

export const PROVIDERS = ["openrouter", "anthropic", "openai", "xai", "deepseek", "qwen"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type KeyTestResult =
  | { ok: true }
  | { ok: false; error: "invalid_key" | "no_credit" | "rate_limited" | "provider_error"; message: string };

/** Everything the app needs to know about a provider, in one place, so adding one is one entry. */
export interface ProviderInfo {
  id: Provider;
  /** What the user sees in the provider picker. */
  label: string;
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
};

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}
