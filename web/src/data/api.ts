import type {
  ApplyResult,
  FollowUpBody,
  KeyTestResult,
  Provider,
  ProviderKeyView,
  RunResultView,
  RunView,
  SavedKeyView,
  SessionView,
  StartRunBody,
} from "../lib/contract";

/** Every non-2xx response, with the server's error code ({error, issues?, message?}). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: readonly string[] = [],
    readonly detail: Record<string, unknown> = {},
  ) {
    super(apiErrorMessage(status, code, issues, detail));
    this.name = "ApiError";
  }
}

/** A sentence a person can act on, for each documented error. */
export function apiErrorMessage(status: number, code: string, issues: readonly string[] = [], detail: Record<string, unknown> = {}): string {
  const message = typeof detail.message === "string" ? detail.message : undefined;
  switch (code) {
    case "unauthenticated":
      return "Your session has ended. Sign in again to continue.";
    case "bad_origin":
      return "This page is not allowed to make changes. Open Caramel from its own address and try again.";
    case "invalid_request":
      return issues.length > 0 ? issues.join(" ") : "The request was not valid.";
    case "missing_key":
      return `There is no API key saved for ${typeof detail.provider === "string" ? detail.provider : "this provider"}. Add one in Model providers.`;
    case "not_found":
      return "That run does not exist, or it belongs to someone else.";
    case "no_patch":
      return "This run did not produce a patch.";
    case "not_ready":
      return "The result is not ready yet.";
    case "conflict":
      return message ?? "That run has not finished yet.";
    case "run_limit":
      return message ?? "You already have a run in progress. Wait for it to finish or cancel it.";
    case "bad_host":
      return "Open Caramel from the address the app printed (127.0.0.1), not localhost.";
    case "connect_unavailable":
      return "This provider cannot be connected by signing in. Paste a key instead.";
    case "network_error":
      return "Caramel's server could not be reached. Check your connection and try again.";
    default:
      return status >= 500 ? "Something went wrong on the server. Try again in a moment." : (message ?? `Request failed (${status}).`);
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: Fetcher;
}

/**
 * The only module that talks to the server. Same-origin requests carry the session cookie and the
 * browser's Origin header, which is what the server's CSRF check expects.
 */
export function createApiClient({ baseUrl = "", fetcher = (input, init) => fetch(input, init) }: ApiClientOptions = {}) {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        credentials: "same-origin",
        ...init,
        headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
      });
    } catch {
      throw new ApiError(0, "network_error");
    }
    if (response.ok) return response;
    let payload: { error?: unknown; issues?: unknown } & Record<string, unknown> = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // Not JSON (a proxy error page): fall through with the status alone.
    }
    const code = typeof payload.error === "string" ? payload.error : response.status === 401 ? "unauthenticated" : "http_error";
    const issues = Array.isArray(payload.issues) ? payload.issues.filter((item): item is string => typeof item === "string") : [];
    throw new ApiError(response.status, code, issues, payload);
  }

  const json = async <T>(path: string, init?: RequestInit): Promise<T> => (await (await request(path, init)).json()) as T;
  const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  return {
    me: () => json<SessionView>("/api/me"),
    logout: () => request("/auth/logout", { method: "POST" }).then(() => undefined),
    loginUrl: `${baseUrl}/auth/github/login`,

    listRuns: () => json<RunView[]>("/api/runs"),
    getRun: (id: string) => json<RunView>(`/api/runs/${encodeURIComponent(id)}`),
    startRun: (body: StartRunBody | FollowUpBody) => json<RunView>("/api/runs", send("POST", body)),
    applyRun: (id: string) => json<ApplyResult>(`/api/runs/${encodeURIComponent(id)}/apply`, send("POST")),
    cancelRun: (id: string) => json<RunView>(`/api/runs/${encodeURIComponent(id)}/cancel`, send("POST")),
    getResult: (id: string) => json<RunResultView>(`/api/runs/${encodeURIComponent(id)}/result`),
    getPatch: async (id: string) => (await request(`/api/runs/${encodeURIComponent(id)}/patch`, { headers: { accept: "text/x-diff" } })).text(),
    patchUrl: (id: string) => `${baseUrl}/api/runs/${encodeURIComponent(id)}/patch`,
    eventsUrl: (id: string) => `${baseUrl}/api/runs/${encodeURIComponent(id)}/events`,

    listProviders: () => json<ProviderKeyView[]>("/api/providers"),
    saveKey: (provider: Provider, key: string, endpoint?: { baseUrl: string; model: string }) =>
      json<SavedKeyView>(`/api/providers/${provider}/key`, send("PUT", { key, ...endpoint })),
    /** Starts a browser sign-in that saves a key by itself; returns the page to open. */
    connectProvider: (provider: Provider) => json<{ url: string }>(`/api/providers/${provider}/connect`, send("POST")),
    testKey: (provider: Provider) => json<KeyTestResult>(`/api/providers/${provider}/test`, send("POST")),
    deleteKey: (provider: Provider) => request(`/api/providers/${provider}/key`, { method: "DELETE" }).then(() => undefined),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
