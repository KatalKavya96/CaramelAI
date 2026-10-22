import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelAdapter, type ModelTurn } from "../src/model";
import { createApp } from "../src/server/app";
import { GitHubAuth } from "../src/server/auth";
import { KeyStore, RunService, SHARED_SERVER_POLICY } from "../src/service";

const ORIGIN = "https://caramel.test";
const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

async function sourceRepo(): Promise<string> {
  const root = await temporaryDirectory("caramel-app-repo-");
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });
  git("init", "-q");
  await writeFile(join(root, "a.txt"), "alpha\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init");
  return root;
}

const turn = (action: ModelTurn["decision"]["action"]): ModelTurn => ({ decision: { action }, usage: { source: "unavailable" } });

async function setup() {
  const data = await temporaryDirectory("caramel-app-");
  const runsRoot = join(data, "runs");
  const keys = await KeyStore.open({ root: join(data, "keys"), masterKey: Buffer.alloc(32, 7).toString("base64") });
  const repo = await sourceRepo();
  const service = await RunService.open({
    runsRoot,
    policy: SHARED_SERVER_POLICY,
    maxConcurrentRuns: 1,
    maxActiveRunsPerUser: 1,
    resolveKey: (owner, provider) => keys.reveal(owner, provider),
    // Shared policy only takes git URLs; the "clone" here hands back a local fixture instead.
    prepareRepository: async () => repo,
    createCommandExecutor: async () => ({ run: async () => { throw new Error("no commands"); } }),
    createModel: () => new FakeModelAdapter([turn({ type: "list_files" }), ...[1, 2, 3].map(() => turn({ type: "finish", summary: "done" }))]),
  });
  const users: Record<string, string> = { "token-a": "github:1", "token-b": "github:2" };
  const app = createApp({
    service,
    keys,
    runsRoot,
    publicOrigin: ORIGIN,
    auth: { userId: async (request) => users[request.headers.get("x-test-user") ?? ""] ?? null },
    testKey: async (_provider, key) => (key.endsWith("good") ? { ok: true } : { ok: false, error: "invalid_key", message: "rejected" }),
    heartbeatMs: 50,
  });
  const call = (method: string, path: string, options: { user?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.user !== undefined) headers["x-test-user"] = options.user;
    if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
    return app(new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }));
  };
  return { call, keys };
}

const RUN = { task: "look around", provider: "openrouter", repo: { kind: "git", url: "https://github.com/katal/demo" } };

async function waitForStatus(call: Awaited<ReturnType<typeof setup>>["call"], id: string, user: string, status: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = await (await call("GET", `/api/runs/${id}`, { user })).json() as { status: string };
    if (run.status === status) return;
    await Bun.sleep(10);
  }
  throw new Error(`run ${id} never reached ${status}`);
}

describe("HTTP API", () => {
  test("requires a session and a matching Origin on writes", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/runs")).status).toBe(401);
    expect((await call("POST", "/api/runs", { user: "token-a", body: RUN, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/runs", { user: "token-a", body: RUN, origin: null })).status).toBe(403);
  });

  test("stores keys encrypted, never returns them, and needs one to start a run", async () => {
    const { call, keys } = await setup();
    const missing = await call("POST", "/api/runs", { user: "token-a", body: RUN });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing_key", provider: "openrouter" });

    const saved = await (await call("PUT", "/api/providers/openrouter/key", { user: "token-a", body: { key: "sk-or-v1-abcdgood" } })).json();
    expect(saved).toMatchObject({ provider: "openrouter", last4: "good", verified: true });
    const listed = await (await call("GET", "/api/providers", { user: "token-a" })).text();
    expect(listed).not.toContain("sk-or-v1");
    expect(await (await call("GET", "/api/providers", { user: "token-b" })).json()).toContainEqual(
      expect.objectContaining({ provider: "openrouter", last4: null }),
    );
    expect(await keys.reveal("github:1", "openrouter")).toBe("sk-or-v1-abcdgood");
    expect(await keys.reveal("github:2", "openrouter")).toBeNull();

    expect((await call("DELETE", "/api/providers/openrouter/key", { user: "token-a" })).status).toBe(204);
    expect(await keys.reveal("github:1", "openrouter")).toBeNull();
  });

  test("reports a typed error when a key test fails", async () => {
    const { call } = await setup();
    await call("PUT", "/api/providers/deepseek/key", { user: "token-a", body: { key: "sk-bad-key-1234" } });
    expect(await (await call("POST", "/api/providers/deepseek/test", { user: "token-a" })).json()).toEqual({
      ok: false, error: "invalid_key", message: "rejected",
    });
    expect((await call("PUT", "/api/providers/claude/key", { user: "token-a", body: { key: "x" } })).status).toBe(404);
  });

  test("starts a run, streams resumable SSE, serves the patch and hides it from other users", async () => {
    const { call } = await setup();
    await call("PUT", "/api/providers/openrouter/key", { user: "token-a", body: { key: "sk-or-v1-abcdgood" } });
    const created = await call("POST", "/api/runs", { user: "token-a", body: RUN });
    expect(created.status).toBe(201);
    const run = await created.json() as { id: string; childRunIds: string[] };
    expect(run.childRunIds).toEqual([]);
    await waitForStatus(call, run.id, "token-a", "partial");

    const stream = await (await call("GET", `/api/runs/${run.id}/events`, { user: "token-a" })).text();
    const ids = [...stream.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids[0]).toBe(1);
    expect(stream).toContain("event: run_finished");
    const resumed = await (await call("GET", `/api/runs/${run.id}/events`, { user: "token-a", headers: { "last-event-id": "3" } })).text();
    expect([...resumed.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))).toEqual(ids.filter((id) => id > 3));

    expect((await call("GET", `/api/runs/${run.id}/patch`, { user: "token-a" })).status).toBe(200);
    expect((await call("GET", `/api/runs/${run.id}`, { user: "token-b" })).status).toBe(404);
    expect((await call("GET", `/api/runs/${run.id}/events`, { user: "token-b" })).status).toBe(404);
    expect((await call("GET", `/api/runs/${run.id}/patch`, { user: "token-b" })).status).toBe(404);
  });

  test("maps validation, conflict and limit errors to typed responses", async () => {
    const { call } = await setup();
    await call("PUT", "/api/providers/openrouter/key", { user: "token-a", body: { key: "sk-or-v1-abcdgood" } });
    const invalid = await call("POST", "/api/runs", { user: "token-a", body: { ...RUN, repo: { kind: "local", path: "/etc" } } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_request" });
    expect((await call("POST", "/api/runs", { user: "token-a", body: "not json{" as unknown })).status).toBe(400);
  });
});

describe("GitHub login", () => {
  test("rejects a callback whose state does not match the cookie", async () => {
    const auth = new GitHubAuth({ clientId: "id", clientSecret: "secret", publicOrigin: ORIGIN, fetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch });
    const login = auth.login();
    expect(login.headers.get("location")).toContain("github.com/login/oauth/authorize");
    const response = await auth.callback(new Request(`${ORIGIN}/auth/github/callback?code=c&state=forged`, { headers: { cookie: "caramel_oauth_state=real" } }));
    expect(response.status).toBe(400);
  });

  test("creates a session from GitHub's user id and drops the access token", async () => {
    const fetcher = (async (url: string) =>
      String(url).includes("access_token")
        ? Response.json({ access_token: "gho_secret" })
        : Response.json({ id: 42, login: "kavya" })) as unknown as typeof fetch;
    const auth = new GitHubAuth({ clientId: "id", clientSecret: "secret", publicOrigin: ORIGIN, fetch: fetcher });
    const state = new URL(auth.login().headers.get("location")!).searchParams.get("state")!;
    const response = await auth.callback(new Request(`${ORIGIN}/auth/github/callback?code=c&state=${state}`, { headers: { cookie: `caramel_oauth_state=${state}` } }));
    expect(response.status).toBe(302);
    const session = response.headers.getSetCookie().find((value) => value.startsWith("caramel_session="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    expect(session).not.toContain("gho_secret");
    const sessionCookie = session.split(";")[0]!;
    expect(await auth.userId(new Request(`${ORIGIN}/api/runs`, { headers: { cookie: sessionCookie } }))).toBe("github:42");
  });
});
