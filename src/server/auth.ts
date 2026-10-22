/** Resolves the signed-in user for a request, or null. The HTTP layer depends only on this. */
export interface Authenticator {
  userId(request: Request): Promise<string | null>;
}

const SESSION_COOKIE = "caramel_session";
const STATE_COOKIE = "caramel_oauth_state";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function setCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  // HttpOnly: page scripts cannot read it. SameSite=Lax: sent on the OAuth redirect back to us,
  // but not on cross-site POSTs; the app also checks Origin on every state-changing request.
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export interface GitHubAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Where the browser reaches this server, e.g. https://caramel.example.com */
  publicOrigin: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * GitHub OAuth login with server-side sessions. The GitHub access token is used once to learn
 * the user's id and then dropped: the server stores only an opaque session id per browser.
 */
export class GitHubAuth implements Authenticator {
  private readonly sessions = new Map<string, { userId: string; login: string; expiresAt: number }>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: GitHubAuthOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private get secure(): boolean {
    return this.options.publicOrigin.startsWith("https://");
  }

  async userId(request: Request): Promise<string | null> {
    return this.session(request)?.userId ?? null;
  }

  session(request: Request): { userId: string; login: string } | null {
    const id = cookie(request, SESSION_COOKIE);
    if (id === null) return null;
    const session = this.sessions.get(id);
    if (session === undefined || session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return { userId: session.userId, login: session.login };
  }

  /** GET /auth/github/login */
  login(): Response {
    const state = randomToken();
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", `${this.options.publicOrigin}/auth/github/callback`);
    url.searchParams.set("scope", "read:user");
    url.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { location: url.toString(), "set-cookie": setCookie(STATE_COOKIE, state, 600, this.secure) },
    });
  }

  /** GET /auth/github/callback: the state cookie must match, which stops login CSRF. */
  async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (state === null || code === null || state !== cookie(request, STATE_COOKIE)) {
      return new Response("Login failed: invalid state.", { status: 400 });
    }
    const tokenResponse = await this.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.options.clientId, client_secret: this.options.clientSecret, code }),
    });
    const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: unknown };
    if (!tokenResponse.ok || typeof token.access_token !== "string") {
      return new Response("Login failed: GitHub did not issue a token.", { status: 502 });
    }
    const userResponse = await this.fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json" },
    });
    const user = (await userResponse.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
    if (!userResponse.ok || typeof user.id !== "number" || typeof user.login !== "string") {
      return new Response("Login failed: could not read the GitHub user.", { status: 502 });
    }
    const sessionId = randomToken();
    this.sessions.set(sessionId, { userId: `github:${user.id}`, login: user.login, expiresAt: this.now() + SESSION_TTL_MS });
    const headers = new Headers({ location: "/" });
    headers.append("set-cookie", setCookie(SESSION_COOKIE, sessionId, SESSION_TTL_MS / 1000, this.secure));
    headers.append("set-cookie", setCookie(STATE_COOKIE, "", 0, this.secure));
    return new Response(null, { status: 302, headers });
  }

  /** POST /auth/logout */
  logout(request: Request): Response {
    const id = cookie(request, SESSION_COOKIE);
    if (id !== null) this.sessions.delete(id);
    return new Response(null, { status: 204, headers: { "set-cookie": setCookie(SESSION_COOKIE, "", 0, this.secure) } });
  }
}
