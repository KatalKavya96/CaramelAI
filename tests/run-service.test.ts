import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentRunResult, runAutonomousTask } from "../src/agent";
import { FakeModelAdapter, type ModelTurn } from "../src/model";
import {
  RunLimitError,
  RunNotFoundError,
  RunRequestError,
  RunService,
  SHARED_SERVER_POLICY,
  type RunServiceOptions,
} from "../src/service";

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
  const root = await temporaryDirectory("caramel-service-repo-");
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });
  git("init", "-q");
  await writeFile(join(root, "a.txt"), "alpha\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init");
  return root;
}

const turn = (action: ModelTurn["decision"]["action"]): ModelTurn => ({ decision: { action }, usage: { source: "unavailable" } });
const LOCAL_POLICY = { ...SHARED_SERVER_POLICY, allowLocalRepos: true };

async function openService(overrides: Partial<RunServiceOptions> = {}): Promise<RunService> {
  return await RunService.open({
    runsRoot: join(await temporaryDirectory("caramel-runs-"), "runs"),
    policy: LOCAL_POLICY,
    maxConcurrentRuns: 2,
    maxActiveRunsPerUser: 1,
    // No command runs in these scripts; this keeps the tests independent of Docker.
    createCommandExecutor: async () => ({ run: async () => { throw new Error("no commands in this test"); } }),
    createModel: () => new FakeModelAdapter([turn({ type: "list_files" }), ...[1, 2, 3].map(() => turn({ type: "finish", summary: "nothing to do" }))]),
    ...overrides,
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !check(); attempt += 1) await Bun.sleep(10);
  expect(check()).toBeTrue();
}

/** A runTask stub that finishes only when the test says so. */
function gatedRunTask() {
  const gates: Array<() => void> = [];
  const runTask = (async () => {
    await new Promise<void>((release) => gates.push(release));
    return { status: "partial", terminationReason: "stub", changedFiles: [] } as unknown as AgentRunResult;
  }) as unknown as typeof runAutonomousTask;
  return { runTask, gates };
}

describe("RunService", () => {
  test("runs a request end to end and scopes every read to its owner", async () => {
    const service = await openService();
    const repo = await sourceRepo();
    const run = await service.start("kavya", { task: "look around", provider: "openrouter", repo: { kind: "local", path: repo } });

    await waitFor(() => service.get("kavya", run.id).status === "partial");
    expect(service.get("kavya", run.id).finishedAt).not.toBeNull();
    expect(service.list("kavya").map((record) => record.id)).toEqual([run.id]);
    expect(service.list("someone-else")).toEqual([]);
    expect(() => service.get("someone-else", run.id)).toThrow(RunNotFoundError);
    await expect(service.cancel("someone-else", run.id)).rejects.toBeInstanceOf(RunNotFoundError);
  });

  test("replays the event log to a late subscriber, resuming after a sequence", async () => {
    const service = await openService();
    const run = await service.start("kavya", { task: "look", provider: "openrouter", repo: { kind: "local", path: await sourceRepo() } });
    await waitFor(() => service.get("kavya", run.id).status === "partial");

    const all: AgentEvent[] = [];
    await service.subscribe("kavya", run.id, 0, (event) => all.push(event));
    expect(all[0]?.type).toBe("run_started");
    expect(all.at(-1)?.type).toBe("run_finished");
    const rest: AgentEvent[] = [];
    await service.subscribe("kavya", run.id, 2, (event) => rest.push(event));
    expect(rest.map((event) => event.sequence)).toEqual(all.slice(2).map((event) => event.sequence));
    await expect(service.subscribe("someone-else", run.id, 0, () => {})).rejects.toBeInstanceOf(RunNotFoundError);
  });

  test("enforces the per-user limit and queues beyond the global cap", async () => {
    const { runTask, gates } = gatedRunTask();
    const service = await openService({ runTask, maxConcurrentRuns: 1, prepareRepository: async () => "/unused" });
    const request = { task: "t", provider: "openrouter", repo: { kind: "local", path: "/unused" } };

    const first = await service.start("a", request);
    await expect(service.start("a", request)).rejects.toBeInstanceOf(RunLimitError);
    const second = await service.start("b", request);
    await waitFor(() => service.get("a", first.id).status === "running");
    expect(service.get("b", second.id).status).toBe("queued");

    gates[0]!();
    await waitFor(() => service.get("b", second.id).status === "running");
    gates[1]!();
    await waitFor(() => service.get("b", second.id).status === "partial");
  });

  test("cancels a queued run without starting it", async () => {
    const { runTask, gates } = gatedRunTask();
    const service = await openService({ runTask, maxConcurrentRuns: 1, prepareRepository: async () => "/unused" });
    const request = { task: "t", provider: "openrouter", repo: { kind: "local", path: "/unused" } };
    await service.start("a", request);
    const queued = await service.start("b", request);
    await service.cancel("b", queued.id);
    expect(service.get("b", queued.id).status).toBe("cancelled");
    gates[0]!();
    await Bun.sleep(20);
    expect(gates).toHaveLength(1);
  });

  test("a clone failure still ends the run with a reason", async () => {
    const service = await openService({
      policy: SHARED_SERVER_POLICY,
      prepareRepository: async () => { throw new Error("Could not clone https://github.com/x/y: not found"); },
    });
    const run = await service.start("a", { task: "t", provider: "openrouter", repo: { kind: "git", url: "https://github.com/x/y" } });
    await waitFor(() => service.get("a", run.id).status === "failed");
    expect(service.get("a", run.id).terminationReason).toContain("Could not clone");
  });

  test("rejects plan mode and host paths on a shared server", async () => {
    const service = await openService({ policy: SHARED_SERVER_POLICY });
    await expect(service.start("a", { task: "t", provider: "openrouter", repo: { kind: "local", path: "/etc" } })).rejects.toBeInstanceOf(RunRequestError);
    await expect(service.start("a", { task: "t", provider: "openrouter", planMode: true, repo: { kind: "git", url: "https://github.com/x/y" } })).rejects.toThrow("plan mode");
  });

  test("marks runs that were active when the server stopped as failed", async () => {
    const runsRoot = join(await temporaryDirectory("caramel-runs-"), "runs");
    await mkdir(join(runsRoot, "r1"), { recursive: true });
    await writeFile(join(runsRoot, "r1", "run.json"), JSON.stringify({
      id: "r1", ownerId: "a", request: {}, status: "running", createdAt: "2026-10-22T00:00:00Z",
      startedAt: null, finishedAt: null, terminationReason: null, changedFiles: [],
    }));
    const service = await openService({ runsRoot });
    expect(service.get("a", "r1")).toMatchObject({ status: "failed", terminationReason: "The server stopped while this run was active." });
  });
});

describe("prepareRepository", () => {
  test("uses a local path as is and reports a failed clone with its URL", async () => {
    const { prepareRepository } = await import("../src/service");
    expect(await prepareRepository({ kind: "local", path: "/some/repo" }, "/unused")).toBe("/some/repo");
    const target = join(await temporaryDirectory("caramel-clone-"), "repo");
    await expect(prepareRepository({ kind: "git", url: "https://127.0.0.1:1/nothing.git" }, target)).rejects.toThrow(
      "Could not clone https://127.0.0.1:1/nothing.git",
    );
  });
});
