import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluatePatch, hashDirectory, loadBenchmarkManifest, sha256, type BenchmarkExecutor } from "../src/benchmark";
import type { CommandResult } from "../src/execution";

const roots: string[] = [];
const tasksRoot = resolve(import.meta.dir, "../benchmarks/tasks");

afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function output(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dinner-benchmark-"));
  roots.push(path);
  return join(path, "evaluation");
}

function localExecutor(workspacePath: string): Promise<BenchmarkExecutor> {
  return Promise.resolve({
    async run(command, timeoutMs, env): Promise<CommandResult> {
      const started = performance.now();
      const child = Bun.spawn(["/bin/sh", "-lc", command], { cwd: workspacePath, env: { ...Bun.env, ...env }, stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      const stream = (preview: string) => ({ preview, previewTruncated: false, logPath: "", logTruncated: false, capturedBytes: new TextEncoder().encode(preview).byteLength });
      return { commandId: crypto.randomUUID(), command, purpose: "verification", cwd: ".", image: "host-test", status: "completed", exitCode, durationMs: performance.now() - started, timeoutMs, stdout: stream(stdout), stderr: stream(stderr) };
    },
  });
}

describe("benchmark runner", () => {
  for (const id of [
    "ts-add", "py-slug", "ts-prefix", "py-median", "ts-clamp", "py-port", "ts-unique", "py-chunks",
    "ts-receipt-rounding", "py-regression-test", "ts-rename-export", "py-env-override", "ts-readme-example", "py-not-a-bug", "ts-timezone-date",
  ]) {
    test(`${id}: rejects baseline and accepts the pinned solution`, async () => {
      const taskRoot = join(tasksRoot, id);
      const manifest = await loadBenchmarkManifest(taskRoot);
      expect(await hashDirectory(join(taskRoot, "fixture"))).toBe(manifest.fixtureSha256);
      expect(await hashDirectory(join(taskRoot, "evaluator"))).toBe(manifest.evaluatorSha256);
      const baseline = await evaluatePatch({ taskRoot, patch: "", outputPath: await output(), executorFactory: localExecutor });
      expect(baseline.outcome).toBe("unsolved");
      expect(baseline.checks.find(({ kind }) => kind === "task")?.passed).toBeFalse();
      const patch = await readFile(join(taskRoot, "solution.patch"), "utf8");
      expect(sha256(patch)).toBe(manifest.solutionSha256);
      const solvedOutput = await output();
      const solved = await evaluatePatch({ taskRoot, patch, outputPath: solvedOutput, executorFactory: localExecutor });
      expect(solved.outcome).toBe("solved");
      expect(solved.checks.every(({ passed }) => passed)).toBeTrue();
      expect(JSON.parse(await readFile(join(solvedOutput, "benchmark-result.json"), "utf8"))).toEqual(solved);
    });
  }

  test("classifies a patch that cannot be applied", async () => {
    const result = await evaluatePatch({ taskRoot: join(tasksRoot, "ts-add"), patch: "not a unified patch\n", outputPath: await output(), executorFactory: localExecutor });
    expect(result.outcome).toBe("invalid_submission");
    expect(result.checks).toEqual([]);
  });

  test("classifies evaluator timeouts separately", async () => {
    const executorFactory = async (): Promise<BenchmarkExecutor> => ({ run: async (command, timeoutMs) => ({
      commandId: "timeout", command, purpose: "verification", cwd: ".", image: "fake", status: "timed_out", exitCode: null, durationMs: timeoutMs, timeoutMs,
      stdout: { preview: "", previewTruncated: false, logPath: "", logTruncated: false, capturedBytes: 0 }, stderr: { preview: "", previewTruncated: false, logPath: "", logTruncated: false, capturedBytes: 0 },
    }) });
    const result = await evaluatePatch({ taskRoot: join(tasksRoot, "ts-add"), patch: "", outputPath: await output(), executorFactory });
    expect(result.outcome).toBe("timeout");
  });
});
