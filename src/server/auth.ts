import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

/** Resolves the signed-in user for a request, or null. The HTTP layer depends only on this. */
export interface Authenticator {
  userId(request: Request): Promise<string | null>;
  /** Display details for /api/me. */
  profile?(request: Request): { login: string } | null;
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

export interface StoredSession {
  userId: string;
  login: string;
  expiresAt: number;
}

/** Where sessions live. Keyed by the browser's opaque session token. */
export interface SessionStore {
  get(token: string): StoredSession | null;
  set(token: string, session: StoredSession): void;
  delete(token: string): void;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  get(token: string): StoredSession | null {
    return this.sessions.get(token) ?? null;
  }
  set(token: string, session: StoredSession): void {
    this.sessions.set(token, session);
  }
  delete(token: string): void {
    this.sessions.delete(token);
  }
}

/**
 * Sessions in SQLite, so a restart does not sign everyone out. Rows are keyed by a SHA-256 of
 * the token: someone who copies the database file still cannot present a valid cookie.
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: Database;

  constructor(path: string, now: () => number = Date.now) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, login TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
    this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  }

  private static hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  get(token: string): StoredSession | null {
    const row = this.db
      .query<{ user_id: string; login: string; expires_at: number }, [string]>(
        "SELECT user_id, login, expires_at FROM sessions WHERE token_hash = ?",
      )
      .get(SqliteSessionStore.hash(token));
    return row === null ? null : { userId: row.user_id, login: row.login, expiresAt: row.expires_at };
  }

  set(token: string, session: StoredSession): void {
    this.db
      .query("INSERT OR REPLACE INTO sessions (token_hash, user_id, login, expires_at) VALUES (?, ?, ?, ?)")
      .run(SqliteSessionStore.hash(token), session.userId, session.login, session.expiresAt);
  }

  delete(token: string): void {
    this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(SqliteSessionStore.hash(token));
  }

  close(): void {
    this.db.close();
  }
}

export interface GitHubAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Where the browser reaches this server, e.g. https://caramel.example.com */
  publicOrigin: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Defaults to memory, which signs everyone out on restart. */
  sessions?: SessionStore;
}

/**
 * GitHub OAuth login with server-side sessions. The GitHub access token is used once to learn
 * the user's id and then dropped: the server stores only an opaque session id per browser.
 */
export class GitHubAuth implements Authenticator {
  private readonly sessions: SessionStore;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: GitHubAuthOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sessions = options.sessions ?? new MemorySessionStore();
  }

  private get secure(): boolean {
    return this.options.publicOrigin.startsWith("https://");
  }

  async userId(request: Request): Promise<string | null> {
    return this.session(request)?.userId ?? null;
  }

  profile(request: Request): { login: string } | null {
    const session = this.session(request);
    return session === null ? null : { login: session.login };
  }

  session(request: Request): { userId: string; login: string } | null {
    const id = cookie(request, SESSION_COOKIE);
    if (id === null) return null;
    const session = this.sessions.get(id);
    if (session === null || session.expiresAt <= this.now()) {
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
