import { resolve } from "node:path";
import { createDeepSeekModel, createOpenRouterModel, createQwenModel } from "../model";
import { KeyStore, RunService, SHARED_SERVER_POLICY } from "../service";
import { createApp } from "./app";
import { GitHubAuth } from "./auth";

function required(name: string): string {
  const value = Bun.env[name]?.trim();
  if (value === undefined || value === "") throw new Error(`${name} is required to start the server.`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(Bun.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

const dataDir = resolve(Bun.env.CARAMEL_DATA_DIR ?? ".caramel-data");
const publicOrigin = required("CARAMEL_PUBLIC_ORIGIN").replace(/\/$/, "");
const runsRoot = resolve(dataDir, "runs");

const keys = await KeyStore.open({ root: resolve(dataDir, "keys"), masterKey: required("CARAMEL_KEY_ENCRYPTION_KEY") });
const auth = new GitHubAuth({
  clientId: required("GITHUB_CLIENT_ID"),
  clientSecret: required("GITHUB_CLIENT_SECRET"),
  publicOrigin,
});
const service = await RunService.open({
  runsRoot,
  policy: SHARED_SERVER_POLICY,
  maxConcurrentRuns: positiveInteger("CARAMEL_MAX_CONCURRENT_RUNS", 2),
  maxActiveRunsPerUser: positiveInteger("CARAMEL_MAX_ACTIVE_RUNS_PER_USER", 1),
  resolveKey: (ownerId, provider) => keys.reveal(ownerId, provider),
  createModel: (request, apiKey) =>
    request.provider === "deepseek"
      ? createDeepSeekModel({ apiKey, ...(request.model === undefined ? {} : { model: request.model }) })
      : request.provider === "qwen"
        ? createQwenModel({ apiKey, ...(request.model === undefined ? {} : { model: request.model }) })
        : createOpenRouterModel({ apiKey, ...(request.model === undefined ? {} : { model: request.model }) }),
});

const app = createApp({
  service,
  keys,
  auth,
  runsRoot,
  publicOrigin,
  extraRoutes: async (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/auth/github/login") return auth.login();
    if (request.method === "GET" && url.pathname === "/auth/github/callback") return await auth.callback(request);
    if (request.method === "POST" && url.pathname === "/auth/logout") {
      if (request.headers.get("origin") !== publicOrigin) return new Response(null, { status: 403 });
      return auth.logout(request);
    }
    if (request.method === "GET" && url.pathname === "/api/me") {
      const session = auth.session(request);
      return session === null
        ? Response.json({ error: "unauthenticated" }, { status: 401 })
        : Response.json(session);
    }
    return null;
  },
});

// Loopback by default: put a TLS reverse proxy in front to expose it.
const server = Bun.serve({
  hostname: Bun.env.HOST ?? "127.0.0.1",
  port: positiveInteger("PORT", 8787),
  // SSE streams stay open for the length of a run.
  idleTimeout: 0,
  fetch: app,
});
console.log(`Caramel server listening on http://${server.hostname}:${server.port} (public origin ${publicOrigin})`);
