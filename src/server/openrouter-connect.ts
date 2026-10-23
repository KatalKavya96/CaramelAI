import type { KeyTestResult, ProviderKeyStore } from "../service";

export const OPENROUTER_CALLBACK_PATH = "/connect/openrouter/callback";
const AUTH_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
/** OpenRouter's codes expire after 10 minutes; a sign-in left open longer starts over. */
const FLOW_TTL_MS = 10 * 60_000;

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem">` +
    `<h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/**
 * "Connect OpenRouter": the user signs in on openrouter.ai and OpenRouter hands this app a key,
 * so nobody copies a key by hand. OAuth with PKCE: the verifier never leaves this process, so a
 * stolen code is useless to anyone else.
 *
 * The callback opens in the user's normal browser, which has no Caramel cookie, so the one-time
 * `state` value is what ties it to the flow the signed-in user started.
 */
export class OpenRouterConnect {
  private readonly pending = new Map<string, { verifier: string; startedAt: number }>();

  constructor(private readonly options: {
    /** Origin OpenRouter redirects back to. Must be http://localhost:<port>: OpenRouter allows any port there. */
    callbackOrigin: string;
    keys: ProviderKeyStore;
    userId: string;
    testKey: (key: string) => Promise<KeyTestResult>;
    fetcher?: typeof fetch;
    now?: () => number;
  }) {}

  async start(): Promise<{ url: string }> {
    const now = this.now();
    for (const [state, flow] of this.pending) if (now - flow.startedAt > FLOW_TTL_MS) this.pending.delete(state);
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    this.pending.set(state, { verifier, startedAt: now });
    const url = new URL(AUTH_URL);
    url.searchParams.set("callback_url", `${this.options.callbackOrigin}${OPENROUTER_CALLBACK_PATH}`);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("key_label", "Caramel desktop");
    return { url: url.toString() };
  }

  async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    const flow = this.pending.get(state);
    // One use only: a replayed or forged callback finds nothing.
    this.pending.delete(state);
    if (flow === undefined || this.now() - flow.startedAt > FLOW_TTL_MS) {
      return page("This sign-in link has expired", "Go back to Caramel and press Connect OpenRouter again.", 400);
    }
    if (code === null || code === "") {
      return page("OpenRouter was not connected", "The sign-in was cancelled. You can close this tab.", 400);
    }

    let key: unknown;
    try {
      const response = await (this.options.fetcher ?? fetch)(EXCHANGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, code_verifier: flow.verifier, code_challenge_method: "S256" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return page("OpenRouter was not connected", `OpenRouter answered ${response.status}. Try connecting again.`, 502);
      key = ((await response.json()) as { key?: unknown }).key;
    } catch {
      return page("OpenRouter was not connected", "Caramel could not reach OpenRouter. Check your connection and try again.", 502);
    }
    if (typeof key !== "string" || key.trim() === "") {
      return page("OpenRouter was not connected", "OpenRouter did not return a key. Try connecting again.", 502);
    }
    const tested = await this.options.testKey(key);
    await this.options.keys.set(this.options.userId, "openrouter", key, tested.ok);
    return page("OpenRouter is connected", "Your key is saved in your system keychain. You can close this tab and go back to Caramel.");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
