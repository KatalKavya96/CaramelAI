import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { AgentEvent, AgentRunResult } from "../agent";
import {
  isProvider,
  MissingProviderKeyError,
  RunConflictError,
  RunLimitError,
  RunNotFoundError,
  RunRequestError,
  testProviderKey,
  type ProviderKeyStore,
  type KeyTestResult,
  type Provider,
  type RunService,
} from "../service";
import type { Authenticator } from "./auth";

/** What this server can do, so one UI adapts to the hosted site and the desktop app. */
export interface Capabilities {
  mode: "hosted" | "local";
  sandbox: string;
  network: { default: "none" | "full"; choices: ("none" | "full")[] };
  repoKinds: ("git" | "local")[];
  /** POST /api/runs/:id/apply writes a local run's patch into the user's folder. */
  canApply: boolean;
}

export const HOSTED_CAPABILITIES: Capabilities = {
  mode: "hosted",
  sandbox: "docker",
  network: { default: "none", choices: ["none"] },
  repoKinds: ["git"],
  canApply: false,
};

export interface AppOptions {
  service: RunService;
  keys: ProviderKeyStore;
  auth: Authenticator;
  runsRoot: string;
  /** The browser origin allowed to make state-changing requests, e.g. https://caramel.example.com */
  publicOrigin: string;
  testKey?: (provider: Provider, key: string) => Promise<KeyTestResult>;
  /** Extra routes handled before the API (login, static files). Returning null falls through. */
  extraRoutes?: (request: Request) => Promise<Response | null> | Response | null;
  heartbeatMs?: number;
  /** Built web UI (web/dist). Served for GETs outside /api and /auth, with index.html as the SPA fallback. */
  staticDir?: string;
  capabilities?: Capabilities;
  /**
   * Host headers this server answers to. A DNS-rebinding page reaches 127.0.0.1 under its own
   * hostname, so on a local server anything but the expected host is refused before routing.
   */
  allowedHosts?: readonly string[];
  /** Starts a sign-in that connects a provider without pasting a key; returns the URL to open. */
  connectProvider?: (provider: Provider) => Promise<{ url: string }> | null;
}

/**
 * The part of result.json a browser may see. Host paths (workspace, logs, patch) and the
 * model's memory are dropped; evidence keeps what the result screen shows.
 */
export function clientResult(result: AgentRunResult) {
  return {
    status: result.status,
    summary: result.summary,
    terminationReason: result.terminationReason,
    changedFiles: result.changedFiles,
    verification: {
      commandsRun: result.verification.commandsRun,
      successfulFinalState: result.verification.successfulFinalState,
      diffReviewedForFinalState: result.verification.diffReviewedForFinalState,
      evidence: result.verification.evidence.map(({ stdoutLogPath: _out, stderrLogPath: _err, ...evidence }) => evidence),
    },
    metrics: result.metrics,
    usage: result.usage,
  };
}

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

async function staticFile(root: string, pathname: string): Promise<Response | null> {
  const canonicalRoot = await realpath(root).catch(() => null);
  if (canonicalRoot === null) return null;
  const serve = async (path: string, immutable: boolean): Promise<Response | null> => {
    const canonical = await realpath(path).catch(() => null);
    // Resolved through symlinks and checked against the root, so ../ or a link cannot escape it.
    if (canonical === null || (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${sep}`))) return null;
    if (!(await stat(canonical)).isFile()) return null;
    const extension = canonical.slice(canonical.lastIndexOf("."));
    return new Response(Bun.file(canonical), {
      headers: {
        "content-type": STATIC_TYPES[extension] ?? "application/octet-stream",
        // Vite fingerprints files under assets/, so they never change; index.html always revalidates.
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  };
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded !== "/" && !decoded.includes("\0")) {
    const found = await serve(resolve(canonicalRoot, `.${decoded}`), decoded.startsWith("/assets/"));
    if (found !== null) return found;
  }
  // Client-side routes such as /runs/123 fall back to the app shell.
  return await serve(resolve(canonicalRoot, "index.html"), false);
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Response => json({ error, ...extra }, status);

/** Maps service errors to the documented HTTP statuses; anything else is a 500 without details. */
function errorResponse(error: unknown): Response {
  if (error instanceof RunRequestError) return fail(400, "invalid_request", { issues: error.issues });
  if (error instanceof MissingProviderKeyError) return fail(400, "missing_key", { provider: error.provider });
  if (error instanceof RunNotFoundError) return fail(404, "not_found");
  if (error instanceof RunConflictError) return fail(409, "conflict", { message: error.message });
  if (error instanceof RunLimitError) return fail(429, "run_limit", { message: error.message });
  console.error(error);
  return fail(500, "internal_error");
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 100_000) throw new RunRequestError(["request: body is too large."]);
  try {
    return JSON.parse(text);
  } catch {
    throw new RunRequestError(["request: body must be JSON."]);
  }
}

const TERMINAL = new Set(["verified", "partial", "blocked", "budget_exhausted", "failed", "cancelled"]);

/**
 * The HTTP API as a fetch handler, so tests call it directly without opening a port.
 * Every route except the extra ones needs a signed-in user; every run route is scoped to them.
 */
export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const testKey = options.testKey ?? ((provider, key) => testProviderKey(provider, key));

  const capabilities = options.capabilities ?? HOSTED_CAPABILITIES;

  return async (request) => {
    try {
      if (options.allowedHosts !== undefined && !options.allowedHosts.includes(request.headers.get("host") ?? "")) {
        return fail(421, "bad_host");
      }
      const extra = await options.extraRoutes?.(request);
      if (extra !== null && extra !== undefined) return extra;

      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) {
        if (request.method === "GET" && options.staticDir !== undefined && !url.pathname.startsWith("/auth/")) {
          const file = await staticFile(options.staticDir, url.pathname);
          if (file !== null) return file;
        }
        return fail(404, "not_found");
      }
      const userId = await options.auth.userId(request);
      if (userId === null) return fail(401, "unauthenticated");
      // Cookies ride along on cross-site requests; checking Origin stops another site from
      // starting or cancelling runs in a signed-in user's name (CSRF).
      if (request.method !== "GET" && request.headers.get("origin") !== options.publicOrigin) {
        return fail(403, "bad_origin");
      }

      const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);
      const route = `${request.method} ${parts.map((part, index) => (index % 2 === 1 ? ":id" : part)).join("/")}`;
      const id = parts[1] ?? "";

      switch (route) {
        case "GET me":
          return json({ userId, ...(options.auth.profile?.(request) ?? {}), capabilities });
        case "GET runs":
          return json(options.service.list(userId));
        case "POST runs":
          return json(await options.service.start(userId, await body(request)), 201);
        case "GET runs/:id":
          return json(options.service.get(userId, id));
        case "POST runs/:id/cancel":
          return json(await options.service.cancel(userId, id));
        case "GET runs/:id/events":
          return await events(options, userId, id, request);
        case "GET runs/:id/result": {
          options.service.get(userId, id);
          const text = await readFile(resolve(options.runsRoot, id, "output", "result.json"), "utf8").catch(() => null);
          if (text === null) return fail(404, "not_ready");
          return json(clientResult(JSON.parse(text) as AgentRunResult));
        }
        case "POST runs/:id/apply":
          if (!capabilities.canApply) return fail(404, "not_found");
          return json(await options.service.apply(userId, id));
        case "GET runs/:id/patch": {
          options.service.get(userId, id);
          const patch = await readFile(resolve(options.runsRoot, id, "output", "patch.diff"), "utf8").catch(() => null);
          if (patch === null) return fail(404, "no_patch");
          return new Response(patch, {
            headers: { "content-type": "text/x-diff; charset=utf-8", "content-disposition": `attachment; filename="caramel-${id}.diff"` },
          });
        }
        case "GET providers":
          return json(await options.keys.list(userId));
        case "PUT providers/:id/key": {
          if (!isProvider(id)) return fail(404, "not_found");
          const input = (await body(request)) as { key?: unknown };
          if (typeof input.key !== "string") throw new RunRequestError(["key: must be a string."]);
          const tested = await testKey(id, input.key.trim());
          const view = await options.keys.set(userId, id, input.key, tested.ok);
          return json({ provider: view.provider, last4: view.last4, verified: view.verified, test: tested });
        }
        case "POST providers/:id/test": {
          if (!isProvider(id)) return fail(404, "not_found");
          const key = await options.keys.reveal(userId, id);
          if (key === null) return fail(400, "missing_key", { provider: id });
          const tested = await testKey(id, key);
          await options.keys.markVerified(userId, id, tested.ok);
          return json(tested);
        }
        case "POST providers/:id/connect": {
          if (!isProvider(id)) return fail(404, "not_found");
          const started = options.connectProvider?.(id) ?? null;
          if (started === null) return fail(404, "connect_unavailable", { provider: id });
          return json(await started);
        }
        case "DELETE providers/:id/key":
          if (!isProvider(id)) return fail(404, "not_found");
          await options.keys.delete(userId, id);
          return new Response(null, { status: 204 });
        default:
          return fail(404, "not_found");
      }
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Server-Sent Events: each event's SSE id is its sequence number, so a browser that reconnects
 * sends Last-Event-ID and gets only what it missed. The stream closes after run_finished.
 */
async function events(options: AppOptions, userId: string, id: string, request: Request): Promise<Response> {
  options.service.get(userId, id);
  const header = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  const after = Number.isInteger(Number(header)) && Number(header) > 0 ? Number(header) : 0;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat !== undefined) clearInterval(heartbeat);
        controller.close();
      };
      const send = (event: AgentEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        if (event.type === "run_finished") close();
      };
      request.signal.addEventListener("abort", close, { once: true });
      unsubscribe = await options.service.subscribe(userId, id, after, send);
      // A run that ended without an agent event log (clone failure, cancelled while queued)
      // has nothing more to stream; tell the client to read the run record instead.
      const current = options.service.get(userId, id);
      if (!closed && TERMINAL.has(current.status)) {
        controller.enqueue(encoder.encode(`event: run_closed\ndata: ${JSON.stringify({ status: current.status })}\n\n`));
        close();
        return;
      }
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, options.heartbeatMs ?? 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
