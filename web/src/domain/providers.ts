import type { Provider } from "../lib/contract";

/** Display copy for each provider the core supports. OpenRouter is the route to Claude, GPT and Grok. */
export const PROVIDER_COPY: Record<Provider, { name: string; blurb: string; keyUrl: string; keyHint: string }> = {
  openrouter: {
    name: "OpenRouter",
    blurb: "One key for Claude, GPT, Grok, Gemini and more.",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "Starts with sk-or-",
  },
  deepseek: {
    name: "DeepSeek",
    blurb: "DeepSeek's own API.",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "Starts with sk-",
  },
  qwen: {
    name: "Qwen",
    blurb: "Alibaba Cloud Model Studio (DashScope).",
    keyUrl: "https://bailian.console.alibabacloud.com/?apiKey=1",
    keyHint: "Starts with sk-",
  },
};
