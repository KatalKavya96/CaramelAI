import type { Provider } from "../lib/contract";

export interface ProviderCopy {
  name: string;
  blurb: string;
  keyUrl: string;
  keyHint: string;
  /** An example model id, for the "Another model" field. */
  modelExample: string;
}

/** Display copy for each provider the core supports. The typecheck fails here when the core adds one. */
export const PROVIDER_COPY: Record<Provider, ProviderCopy> = {
  openrouter: {
    name: "OpenRouter",
    blurb: "One key for Claude, GPT, Grok, DeepSeek and more, including free models. Provider usage is billed to your account.",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "Starts with sk-or-",
    modelExample: "qwen/qwen3-coder:free",
  },
  anthropic: {
    name: "Claude",
    blurb: "Anthropic's own API. Shows tokens, not cost.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Starts with sk-ant-",
    modelExample: "claude-sonnet-5-5",
  },
  openai: {
    name: "GPT",
    blurb: "OpenAI's own API. Shows tokens, not cost.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-",
    modelExample: "gpt-5.2",
  },
  xai: {
    name: "Grok",
    blurb: "xAI's own API. Shows tokens, not cost.",
    keyUrl: "https://console.x.ai",
    keyHint: "Starts with xai-",
    modelExample: "grok-4",
  },
  deepseek: {
    name: "DeepSeek",
    blurb: "DeepSeek's own API.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "Starts with sk-",
    modelExample: "deepseek-flash",
  },
  qwen: {
    name: "Qwen",
    blurb: "Alibaba Cloud Model Studio (DashScope).",
    keyUrl: "https://bailian.console.alibabacloud.com/?apiKey=1",
    keyHint: "Starts with sk-",
    modelExample: "qwen-plus",
  },
  custom: {
    name: "Custom endpoint",
    blurb: "Any OpenAI-compatible server: Ollama or LM Studio on this computer, Groq, Together and others.",
    keyUrl: "https://platform.openai.com/docs/api-reference/chat",
    keyHint: "Leave empty for a local server",
    modelExample: "qwen2.5-coder",
  },
};
