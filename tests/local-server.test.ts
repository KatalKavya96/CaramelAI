import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelAdapter, type ModelTurn } from "../src/model";
import { startLocalServer, type LocalServer } from "../src/server/local";
import type { SecretBackend } from "../src/service";

const cleanup: string[] = [];
const servers: LocalServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

class MemorySecrets implements SecretBackend {
  readonly values = new Map<string, string>();
  async get(options: { service: string; name: string }) {
    return this.values.get(`${options.service}/${options.name}`) ?? null;
  }
  async set(options: { service: string; name: string; value: string }) {
    this.values.set(`${options.service}/${options.name}`, options.value);
  }
  async delete(options: { service: string; name: string }) {
    return this.values.delete(`${options.service}/${options.name}`);
  }
}

const turn = (action: ModelTurn["decision"]["action"]): ModelTurn => ({ decision: { action }, usage: { source: "unavailable" } });

async function launch(fetcher?: typeof fetch) {
  const dataDir = await temporaryDirectory("caramel-local-");
  const secrets = new MemorySecrets();
  const server = await startLocalServer({
    dataDir,
    secrets,
    webDist: join(dataDir, "no-web"),
    testKey: async () => ({ ok: false, error: "invalid_key", message: "offline test" }),
    ...(fetcher === undefined ? {} : { fetcher }),
    runService: {
      createCommandExecutor: async () => ({ run: async () => { throw new Error("no commands"); } }),
      createModel: () => new FakeModelAdapter([turn({ type: "list_files" }), ...[1, 2, 3].map(() => turn({ type: "finish", summary: "done" }))]),
    },
  });
  servers.push(server);
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    fetch(`${server.origin}${path}`, {
      redirect: "manual",
      ...init,
      headers: {
        ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
        ...(init.method !== undefined && init.method !== "GET" ? { origin: server.origin, "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  return { server, secrets, dataDir, call };
}

describe("local desktop server", () => {
  test("listens only on loopback and refuses other Host headers (DNS rebinding)", async () => {
    const { server, call } = await launch();
    expect(server.origin.startsWith("http://127.0.0.1:")).toBeTrue();
    const rebound = await call("/api/me", { headers: { host: "evil.example:80", authorization: `Bearer ${server.token}` } });
    expect(rebound.status).toBe(421);
  });

  test("swaps the launch token for an HttpOnly cookie and needs it on every API call", async () => {
    const { server, call } = await launch();
    expect((await call("/api/me")).status).toBe(401);
    expect((await call("/?token=wrong")).status).toBe(401);

    const signIn = await call(new URL(server.launchUrl).pathname + new URL(server.launchUrl).search);
    expect(signIn.status).toBe(302);
    expect(signIn.headers.get("location")).toBe("/");
    const setCookie = signIn.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");

    const me = await (await call("/api/me", { cookie: setCookie.split(";")[0]! })).json();
    expect(me).toMatchObject({
      userId: "local",
      capabilities: { mode: "local", repoKinds: ["local", "git"], canApply: true, network: { default: "none", choices: ["none", "full"] } },
    });
  });

  test("keeps keys in the OS keychain and only their last four characters on disk", async () => {
    const { server, secrets, dataDir, call } = await launch();
    const auth = { authorization: `Bearer ${server.token}` };
    const saved = await call("/api/providers/openrouter/key", { method: "PUT", headers: auth, body: JSON.stringify({ key: "sk-or-v1-localsecret" }) });
    expect(await saved.json()).toMatchObject({ provider: "openrouter", last4: "cret" });
    expect([...secrets.values.values()]).toEqual(["sk-or-v1-localsecret"]);
    expect(await readFile(join(dataDir, "keychain-index.json"), "utf8")).not.toContain("localsecret");
  });

  test("runs on a local folder, with the network choice recorded on the run", async () => {
    const { server, call } = await launch();
    const auth = { authorization: `Bearer ${server.token}` };
    await call("/api/providers/openrouter/key", { method: "PUT", headers: auth, body: JSON.stringify({ key: "sk-or-v1-localsecret" }) });
    const repo = await temporaryDirectory("caramel-local-repo-");
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    await writeFile(join(repo, "a.txt"), "alpha\n");
    Bun.spawnSync(["git", "add", "."], { cwd: repo });
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init"], { cwd: repo });

    const created = await call("/api/runs", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ task: "look", provider: "openrouter", repo: { kind: "local", path: repo }, network: "full" }),
    });
    expect(created.status).toBe(201);
    const run = await created.json() as { id: string; request: { network: string } };
    expect(run.request.network).toBe("full");
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const current = await (await call(`/api/runs/${run.id}`, { headers: auth })).json() as { status: string };
      if (current.status === "partial") break;
      await Bun.sleep(10);
    }
    const applied = await (await call(`/api/runs/${run.id}/apply`, { method: "POST", headers: auth })).json();
    expect(applied).toMatchObject({ applied: false, reason: "no_changes" });
  });

  test("a relative folder path is rejected", async () => {
    const { server, call } = await launch();
    const response = await call("/api/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ task: "look", provider: "openrouter", repo: { kind: "local", path: "repo" } }),
    });
    expect(response.status).toBe(400);
  });

  test("Connect OpenRouter: PKCE sign-in saves the key OpenRouter returns, once", async () => {
    const exchanges: Record<string, string>[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      exchanges.push(JSON.parse(String(init.body)));
      return Response.json({ key: "sk-or-v1-from-oauth" });
    }) as unknown as typeof fetch;
    const { server, secrets, call } = await launch(fetcher);
    const auth = { authorization: `Bearer ${server.token}` };
    const port = new URL(server.origin).port;

    // Only OpenRouter offers sign-in; the others need a pasted key.
    expect((await call("/api/providers/anthropic/connect", { method: "POST", headers: auth })).status).toBe(404);
    const started = await call("/api/providers/openrouter/connect", { method: "POST", headers: auth });
    const url = new URL(((await started.json()) as { url: string }).url);
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe(`http://localhost:${port}/connect/openrouter/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;

    // The callback arrives in the system browser: no cookie, Host is localhost.
    const callback = (query: string) =>
      call(`/connect/openrouter/callback?${query}`, { headers: { host: `localhost:${port}` } });
    expect((await callback(`state=forged&code=abc`)).status).toBe(400);
    const done = await callback(`state=${state}&code=abc`);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("OpenRouter is connected");

    // The verifier we sent hashes to the challenge OpenRouter saw.
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ code: "abc", code_challenge_method: "S256" });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchanges[0]!.code_verifier));
    expect(Buffer.from(digest).toString("base64url")).toBe(url.searchParams.get("code_challenge")!);
    expect([...secrets.values.values()]).toContain("sk-or-v1-from-oauth");

    // Replaying the same callback does nothing.
    expect((await callback(`state=${state}&code=abc`)).status).toBe(400);
    expect(exchanges).toHaveLength(1);
    // Any other path on localhost is still refused by the Host check.
    expect((await call("/api/me", { headers: { host: `localhost:${port}`, ...auth } })).status).toBe(421);
  });

  test("a custom endpoint is saved with its URL, and the key stays optional", async () => {
    const { server, call } = await launch();
    const auth = { authorization: `Bearer ${server.token}` };
    const saved = await call("/api/providers/custom/key", { method: "PUT", headers: auth, body: JSON.stringify({ baseUrl: "http://localhost:11434/v1/" }) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ provider: "custom", endpoint: "http://localhost:11434/v1", last4: "none" });
    const listed = (await (await call("/api/providers", { headers: auth })).json()) as { provider: string; endpoint: string | null }[];
    expect(listed.find(({ provider }) => provider === "custom")?.endpoint).toBe("http://localhost:11434/v1");
    // Over plain http to another machine the key would travel in clear text.
    const refused = await call("/api/providers/custom/key", { method: "PUT", headers: auth, body: JSON.stringify({ baseUrl: "http://10.0.0.5/v1", key: "secret-key" }) });
    expect(refused.status).toBe(400);
  });
});
