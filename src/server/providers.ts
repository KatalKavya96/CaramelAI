import { createDeepSeekModel, createOpenRouterModel, createQwenModel, type ModelAdapter } from "../model";
import type { RunRequest } from "../service";

/** The model adapter for a run, built with the user's own key. */
export function createProviderModel(request: RunRequest, apiKey: string): ModelAdapter {
  const model = request.model === undefined ? {} : { model: request.model };
  if (request.provider === "deepseek") return createDeepSeekModel({ apiKey, ...model });
  if (request.provider === "qwen") return createQwenModel({ apiKey, ...model });
  return createOpenRouterModel({ apiKey, ...model });
}
