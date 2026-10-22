import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { FakeModelAdapter, type ModelTurn } from "../src/model";
import { createApp } from "../src/server/app";
import { GitHubAuth, SqliteSessionStore } from "../src/server/auth";
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

async function setup(extra: { staticDir?: string } = {}) {
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
    ...extra,
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
    const resultText = await (await call("GET", `/api/runs/${run.id}/result`, { user: "token-a" })).text();
    expect(JSON.parse(resultText)).toMatchObject({ status: "partial", verification: { successfulFinalState: false } });
    expect(resultText).not.toContain("workspacePath");
    expect(resultText).not.toContain("LogPath");
    expect(resultText).not.toContain("memory");
    expect((await call("GET", `/api/runs/${run.id}/result`, { user: "token-b" })).status).toBe(404);
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

describe("web UI files", () => {
  test("serves built files, falls back to index.html for app routes, and never leaves the folder", async () => {
    const dist = await temporaryDirectory("caramel-dist-");
    await mkdir(join(dist, "assets"));
    await writeFile(join(dist, "index.html"), "<!doctype html><div id=root></div>");
    await writeFile(join(dist, "assets", "app-1a2b.js"), "console.log(1)");
    const secret = join(dirname(dist), `${basename(dist)}-secret.txt`);
    await writeFile(secret, "secret");
    cleanup.push(secret);
    const { call } = await setup({ staticDir: dist });

    const asset = await call("GET", "/assets/app-1a2b.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const shell = await call("GET", "/runs/123");
    expect(await shell.text()).toContain("id=root");
    expect(shell.headers.get("cache-control")).toBe("no-cache");
    for (const path of [`/../${basename(dist)}-secret.txt`, `/%2e%2e/${basename(dist)}-secret.txt`]) {
      expect(await (await call("GET", path)).text()).not.toContain("secret");
    }
    expect((await call("GET", "/auth/whatever")).status).toBe(404);
    expect((await call("GET", "/api/nope", { user: "token-a" })).status).toBe(404);
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

  test("SQLite sessions survive a restart, expire, and store only a hash of the token", async () => {
    const dir = await temporaryDirectory("caramel-sessions-");
    const path = join(dir, "sessions.db");
    let now = 1_000;
    const first = new SqliteSessionStore(path, () => now);
    first.set("token-123", { userId: "github:1", login: "kavya", expiresAt: 5_000 });
    first.set("token-old", { userId: "github:2", login: "old", expiresAt: 2_000 });
    first.close();
    expect(await Bun.file(path).text()).not.toContain("token-123");

    now = 3_000;
    const reopened = new SqliteSessionStore(path, () => now);
    expect(reopened.get("token-123")).toEqual({ userId: "github:1", login: "kavya", expiresAt: 5_000 });
    expect(reopened.get("token-old")).toBeNull();
    reopened.delete("token-123");
    expect(reopened.get("token-123")).toBeNull();
    reopened.close();
  });
});
