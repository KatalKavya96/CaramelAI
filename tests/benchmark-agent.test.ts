import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAutonomousTask, type AgentRunResult, type CommandExecutor } from "../src/agent";
import { emptyUsageSummary } from "../src/agent/types";
import { runAgentBenchmark, summarize, type AgentRunRecord, type BenchmarkExecutor, type BenchmarkResult } from "../src/benchmark";
import type { CommandRequest, CommandResult } from "../src/execution";
import { FakeModelAdapter, type ModelTurn } from "../src/model";

const tasksRoot = resolve(import.meta.dir, "../benchmarks/tasks");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function scratch(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "caramel-bench-agent-"));
  roots.push(path);
  return path;
}

async function shell(command: string, cwd: string, env: Record<string, string> = {}) {
  const started = performance.now();
  const child = Bun.spawn(["/bin/sh", "-lc", command], { cwd, env: { ...Bun.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr, durationMs: performance.now() - started };
}

function result(command: string, timeoutMs: number, run: Awaited<ReturnType<typeof shell>>, logsPath = ""): CommandResult {
  const stream = (preview: string, name: string) => ({ preview, previewTruncated: false, logPath: join(logsPath, name), logTruncated: false, capturedBytes: preview.length });
  return {
    commandId: crypto.randomUUID(), command, purpose: "verification", cwd: ".", image: "host-test", status: "completed",
    exitCode: run.exitCode, durationMs: run.durationMs, timeoutMs, stdout: stream(run.stdout, "out.log"), stderr: stream(run.stderr, "err.log"),
  };
}

/** The agent's commands and the hidden checks run on the host in tests; the real CLI sandboxes both. */
class HostExecutor implements CommandExecutor {
  constructor(private readonly workspacePath: string, private readonly logsPath: string) {}
  async run(request: CommandRequest): Promise<CommandResult> {
    await mkdir(this.logsPath, { recursive: true });
    const run = await shell(request.command, resolve(this.workspacePath, request.cwd ?? "."));
    await writeFile(join(this.logsPath, "out.log"), run.stdout);
    await writeFile(join(this.logsPath, "err.log"), run.stderr);
    return { ...result(request.command, request.timeoutMs ?? 60_000, run, this.logsPath), purpose: request.purpose };
  }
}

const hostEvaluator = async (workspacePath: string): Promise<BenchmarkExecutor> => ({
  run: async (command, timeoutMs, env) => result(command, timeoutMs, await shell(command, workspacePath, env)),
});

const turn = (action: ModelTurn["decision"]["action"]): ModelTurn => ({ decision: { action }, usage: { source: "unavailable" } });

/** Two scripted "models": one fixes the bug, one makes the public tests pass with a wrong fix. */
function scriptedModel(name: string) {
  const replacement = name === "careful" ? "return Math.round(amount * 100);" : "return Math.ceil(amount * 100);";
  return new FakeModelAdapter([
    turn({ type: "read_file", path: "src/money.ts" }),
    turn({ type: "replace_text", path: "src/money.ts", search: "return Math.floor(amount * 100);", replacement }),
    turn({ type: "inspect_diff" }),
    turn({ type: "run_command", command: "bun run test", purpose: "verification" }),
    turn({ type: "finish", summary: "Fixed the rounding in toCents; tests pass." }),
  ]);
}

describe("agent benchmark", () => {
  test("scores the agent with the hidden checks, not its own claim", async () => {
    const output = join(await scratch(), "pilot");
    const scorecard = await runAgentBenchmark(
      { tasksRoot, taskIds: ["ts-receipt-rounding"], provider: "test", models: ["careful", "overconfident"], repeats: 1, outputPath: output },
      {
        createModel: scriptedModel,
        runAgent: (options, dependencies) => runAutonomousTask(
          { ...options, verificationCommands: ["bun run test"] },
          { ...dependencies, createCommandExecutor: async (workspace, logs) => new HostExecutor(workspace, logs) },
        ),
        evaluatorExecutor: hostEvaluator,
        harnessRevision: "test",
      },
    );

    const [careful, overconfident] = scorecard.runs;
    expect(careful).toMatchObject({ model: "careful", outcome: "solved", claimedVerified: true, taskCheckPassed: true, regressionCheckPassed: true });
    // Math.ceil passes the project's own tests, so the agent says "verified"; the receipts are still wrong.
    expect(overconfident).toMatchObject({ model: "overconfident", outcome: "unsolved", claimedVerified: true, taskCheckPassed: false });
    expect(scorecard.models.map(({ model, solved, falseSuccessRate }) => ({ model, solved, falseSuccessRate }))).toEqual([
      { model: "careful", solved: 1, falseSuccessRate: 0 },
      { model: "overconfident", solved: 0, falseSuccessRate: 1 },
    ]);
    // The scripted model reports no usage, so cost is unknown rather than $0.
    expect(careful!.costUsd).toBeNull();
    expect(JSON.parse(await readFile(join(output, "scorecard.json"), "utf8"))).toEqual(scorecard);
  }, 120_000);
});

function fakeAgent(options: { costUsd: number; terminationReason?: string; changed?: boolean }): AgentRunResult {
  const usage = { ...emptyUsageSummary(), providerInputTokens: 1000, providerOutputTokens: 100, providerTotalTokens: 1100, providerCostUsd: options.costUsd, modelTimeMs: 600 };
  return {
    status: "partial", terminationReason: options.terminationReason ?? "Step budget exhausted.", changedFiles: options.changed === false ? [] : ["src/x.ts"],
    patchPath: "/nonexistent/patch.diff", usage, metrics: { steps: 3, modelCalls: 3, commandsRun: 1, stagnationInterventions: 0, verificationReserveActivations: 0, durationMs: 1000 },
  } as unknown as AgentRunResult;
}

const evaluation = (outcome: BenchmarkResult["outcome"]): BenchmarkResult => ({
  schemaVersion: 1, taskId: "t", outcome, startedAt: "", finishedAt: "", patchSha256: "", fixtureSha256: "", evaluatorSha256: "", checks: [],
});

describe("agent benchmark spending", () => {
  test("stops starting runs at the spending limit and records what was skipped", async () => {
    const scorecard = await runAgentBenchmark(
      { tasksRoot, taskIds: ["ts-add", "py-port"], provider: "openrouter", models: ["a", "b"], repeats: 1, outputPath: join(await scratch(), "out"), maxCostUsd: 1 },
      { createModel: () => new FakeModelAdapter([]), runAgent: async () => fakeAgent({ costUsd: 0.6 }), evaluate: async () => evaluation("unsolved") },
    );
    expect(scorecard.runs.map(({ outcome }) => outcome)).toEqual(["unsolved", "unsolved", "skipped_budget", "skipped_budget"]);
    expect(scorecard.stoppedEarly).toContain("$1.00");
    // Both models got the same task before the stop, so the comparison stays fair.
    expect(scorecard.runs.slice(0, 2).map(({ model, taskId }) => `${model}:${taskId}`)).toEqual(["a:ts-add", "b:ts-add"]);
  });

  test("a rate-limited run is a provider error, kept out of the solve rate", async () => {
    let call = 0;
    const scorecard = await runAgentBenchmark(
      { tasksRoot, taskIds: ["ts-add", "py-port"], provider: "openrouter", models: ["a"], repeats: 1, outputPath: join(await scratch(), "out") },
      {
        createModel: () => new FakeModelAdapter([]),
        runAgent: async () => (call++ === 0 ? fakeAgent({ costUsd: 0, changed: false, terminationReason: "Model error (rate_limit): 429" }) : fakeAgent({ costUsd: 0.1 })),
        evaluate: async () => evaluation(call === 1 ? "unsolved" : "solved"),
      },
    );
    expect(scorecard.runs.map(({ outcome }) => outcome)).toEqual(["provider_error", "solved"]);
    expect(scorecard.models[0]).toMatchObject({ attempted: 2, providerErrors: 1, scored: 1, solved: 1, solveRate: 1, costPerSolvedUsd: 0.1 });
  });
});

describe("scorecard summary", () => {
  const run = (overrides: Partial<AgentRunRecord>): AgentRunRecord => ({
    taskId: "t", split: "development", model: "m", attempt: 1, outcome: "solved", agentStatus: "verified", claimedVerified: true,
    taskCheckPassed: true, regressionCheckPassed: true, terminationReason: "", durationMs: 1000, modelTimeMs: 400, steps: 4, modelCalls: 4,
    tokens: { input: 900, output: 100, total: 1000, cachedInput: 300 }, costUsd: 0.01, directory: "", ...overrides,
  });

  test("cost per solved task counts the failed runs too, and regressions are task-passed-but-broke-something", () => {
    const summary = summarize([
      run({}),
      run({ outcome: "unsolved", claimedVerified: false, regressionCheckPassed: false, split: "held_out" }),
      run({ outcome: "unsolved", taskCheckPassed: false, costUsd: null }),
    ], "m");
    expect(summary).toMatchObject({
      solved: 1, scored: 3, verifiedClaims: 2, falseSuccesses: 1, falseSuccessRate: 0.5,
      regressions: 1, regressionRate: 0.5, costComplete: false, costPerSolvedUsd: null, tokensPerSolved: 3000,
      solveRateBySplit: { development: 0.5, heldOut: 0 }, modelTimeShare: 0.4,
    });
    expect(summary.cacheHitShare).toBeCloseTo(1 / 3);
  });
});
