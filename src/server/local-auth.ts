import { timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import type { Authenticator } from "./auth";

const COOKIE = "caramel_local";

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sameToken(candidate: string | null, token: string): boolean {
  if (candidate === null) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(token);
  // Constant time, so response timing does not leak how much of a guess was right.
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

/**
 * Single-user sign-in for the desktop app. A server on 127.0.0.1 is reachable by every web page
 * the user opens, so being local is not proof of being the user. Each launch makes a random
 * token; whoever opens the printed URL gets it as an HttpOnly cookie, and every API call needs it.
 * The Host check (in createApp) separately stops DNS-rebinding pages from reading responses.
 */
export class LocalAuth implements Authenticator {
  readonly token: string;
  private readonly login: string;

  constructor(options: { token?: string; login?: string } = {}) {
    this.token = options.token ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    this.login = options.login ?? userInfo().username;
  }

  async userId(request: Request): Promise<string | null> {
    const header = request.headers.get("authorization");
    const bearer = header?.startsWith("Bearer ") === true ? header.slice("Bearer ".length) : null;
    return sameToken(cookie(request, COOKIE), this.token) || sameToken(bearer, this.token) ? "local" : null;
  }

  profile(): { login: string } {
    return { login: this.login };
  }

  /**
   * Handles `?token=` on a page load: sets the cookie and redirects to the same URL without the
   * token, so it does not stay in history or get copied with the address. Returns null otherwise.
   */
  exchange(request: Request): Response | null {
    if (request.method !== "GET") return null;
    const url = new URL(request.url);
    const offered = url.searchParams.get("token");
    if (offered === null) return null;
    if (!sameToken(offered, this.token)) return new Response("This link is from an earlier launch. Start Caramel again.", { status: 401 });
    url.searchParams.delete("token");
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.pathname}${url.search}`,
        // No Max-Age: the cookie ends with the browser session, and the token with this launch.
        "set-cookie": `${COOKIE}=${encodeURIComponent(this.token)}; Path=/; HttpOnly; SameSite=Strict`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
}
