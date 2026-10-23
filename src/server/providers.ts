import type { ModelAdapter } from "../model";
import { PROVIDER_INFO } from "../model/providers";
import type { RunRequest } from "../service";

/** The model adapter for a run, built with the user's own key. */
export function createProviderModel(request: RunRequest, apiKey: string): ModelAdapter {
  return PROVIDER_INFO[request.provider].create({ apiKey, ...(request.model === undefined ? {} : { model: request.model }) });
}
