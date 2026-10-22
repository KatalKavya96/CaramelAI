import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentEvent } from "../agent";
import {
  isProvider,
  MissingProviderKeyError,
  RunConflictError,
  RunLimitError,
  RunNotFoundError,
  RunRequestError,
  testProviderKey,
  type KeyStore,
  type KeyTestResult,
  type Provider,
  type RunService,
} from "../service";
import type { Authenticator } from "./auth";

export interface AppOptions {
  service: RunService;
  keys: KeyStore;
  auth: Authenticator;
  runsRoot: string;
  /** The browser origin allowed to make state-changing requests, e.g. https://caramel.example.com */
  publicOrigin: string;
  testKey?: (provider: Provider, key: string) => Promise<KeyTestResult>;
  /** Extra routes handled before the API (login, static files). Returning null falls through. */
  extraRoutes?: (request: Request) => Promise<Response | null> | Response | null;
  heartbeatMs?: number;
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

  return async (request) => {
    try {
      const extra = await options.extraRoutes?.(request);
      if (extra !== null && extra !== undefined) return extra;

      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return fail(404, "not_found");
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
