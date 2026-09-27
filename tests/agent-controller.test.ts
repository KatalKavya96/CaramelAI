import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAutonomousTask, type CommandExecutor } from "../src/agent";
import { type CommandRequest, type CommandResult } from "../src/execution";
import { FakeModelAdapter, ModelError, type ModelTurn } from "../src/model";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

async function codingFixture(): Promise<string> {
  const root = await temporaryDirectory("dinner-agent-source-");
  git(root, ["init", "-q"]);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "package.json"), '{"type":"module","scripts":{"test":"bun test"}}\n');
  await writeFile(
    join(root, "src", "math.ts"),
    "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
  );
  await writeFile(
    join(root, "tests", "math.test.ts"),
    'import { expect, test } from "bun:test";\nimport { add } from "../src/math";\ntest("adds", () => expect(add(2, 3)).toBe(5));\n',
  );
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  return root;
}

function turn(action: ModelTurn["decision"]["action"], intent?: string): ModelTurn {
  return {
    decision: { action, ...(intent === undefined ? {} : { intent }) },
    usage: { source: "unavailable" },
  };
}

class LocalCommandExecutor implements CommandExecutor {
  constructor(
    private readonly workspacePath: string,
    private readonly logsPath: string,
  ) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    const startedAt = Date.now();
    const cwd = request.cwd ?? ".";
    const process = Bun.spawn(["/bin/sh", "-lc", request.command], {
      cwd: resolve(this.workspacePath, cwd),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    const id = crypto.randomUUID();
    const stdoutPath = join(this.logsPath, `${id}.stdout.log`);
    const stderrPath = join(this.logsPath, `${id}.stderr.log`);
    await Promise.all([writeFile(stdoutPath, stdout), writeFile(stderrPath, stderr)]);
    return {
      commandId: id,
      command: request.command,
      purpose: request.purpose,
      cwd,
      image: "test-host-runner",
      status: "completed",
      exitCode,
      durationMs: Date.now() - startedAt,
      timeoutMs: request.timeoutMs ?? 10_000,
      stdout: {
        preview: stdout,
        previewTruncated: false,
        logPath: stdoutPath,
        logTruncated: false,
        capturedBytes: Buffer.byteLength(stdout),
      },
      stderr: {
        preview: stderr,
        previewTruncated: false,
        logPath: stderrPath,
        logTruncated: false,
        capturedBytes: Buffer.byteLength(stderr),
      },
    };
  }
}

const FIX_PATCH = `diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,3 @@
 export function add(a: number, b: number): number {
-  return a - b;
+  return a + b;
 }
`;

async function runWithScript(options: {
  source: string;
  script: readonly (ModelTurn | Error)[];
  maxSteps?: number;
  maxRepairAttempts?: number;
  maxContextChars?: number;
  verificationReserveSteps?: number;
  maxStagnationInterventions?: number;
  repositoryMapEnabled?: boolean;
}) {
  const parent = await temporaryDirectory("dinner-agent-output-");
  const outputPath = join(parent, "run");
  const model = new FakeModelAdapter(options.script);
  const result = await runAutonomousTask(
    {
      repoPath: options.source,
      outputPath,
      task: "Fix add so the existing test passes.",
      maxSteps: options.maxSteps ?? 10,
      maxMinutes: 2,
      maxModelCalls: 10,
      ...(options.maxRepairAttempts === undefined ? {} : { maxRepairAttempts: options.maxRepairAttempts }),
      ...(options.maxContextChars === undefined ? {} : { maxContextChars: options.maxContextChars }),
      ...(options.verificationReserveSteps === undefined ? {} : { verificationReserveSteps: options.verificationReserveSteps }),
      ...(options.maxStagnationInterventions === undefined ? {} : { maxStagnationInterventions: options.maxStagnationInterventions }),
      ...(options.repositoryMapEnabled === undefined ? {} : { repositoryMapEnabled: options.repositoryMapEnabled }),
    },
    {
      model,
      runId: "test-run",
      createCommandExecutor: async (workspacePath, logsPath) =>
        new LocalCommandExecutor(workspacePath, logsPath),
    },
  );
  return { result, model };
}

describe("autonomous agent vertical slice", () => {
  test("inspects, patches, verifies, finishes, and exports evidence", async () => {
    const source = await codingFixture();
    const { result, model } = await runWithScript({
      source,
      script: [
        turn({ type: "list_files", path: ".", maxDepth: 3 }, "map repository"),
        turn({ type: "read_file", path: "src/math.ts" }, "inspect implementation"),
        turn({ type: "apply_patch", patch: FIX_PATCH }, "correct addition"),
        turn(
          { type: "run_command", command: "bun test", purpose: "verification" },
          "verify behavior",
        ),
        turn({ type: "inspect_diff" }, "review changes"),
        turn({ type: "finish", summary: "Corrected addition and verified the test." }),
      ],
    });

    expect(result.status).toBe("verified");
    expect(result.changedFiles).toEqual(["src/math.ts"]);
    expect(result.verification).toMatchObject({ commandsRun: 1, successfulFinalState: true });
    expect(result.metrics).toMatchObject({ steps: 5, modelCalls: 6 });
    expect(model.requests).toHaveLength(6);
    expect(await readFile(join(source, "src", "math.ts"), "utf8")).toContain("a - b");
    expect(await readFile(result.patchPath, "utf8")).toContain("return a + b");
    expect(JSON.parse(await readFile(result.resultPath, "utf8"))).toMatchObject({
      status: "verified",
      changedFiles: ["src/math.ts"],
    });
    expect(await Bun.file(result.reportPath).exists()).toBeTrue();
    expect(await readFile(result.reportPath, "utf8")).toContain("Final-state verification: PASS");
    const events = (await readFile(result.eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({ sequence: 1, type: "run_started" });
    expect(events.at(-1)).toMatchObject({ type: "run_finished", payload: { status: "verified" } });
  });

  test("recovers from stale patch context by replacing a previously read file", async () => {
    const source = await codingFixture();
    const stalePatch = FIX_PATCH.replace("-  return a - b;", "-  return notTheCurrentCode;");
    const replacement = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";

    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "read_file", path: "src/math.ts" }, "inspect implementation"),
        turn({ type: "apply_patch", patch: stalePatch }, "try focused patch"),
        turn(
          { type: "replace_file", path: "src/math.ts", content: replacement },
          "replace file after patch context failed",
        ),
        turn(
          { type: "run_command", command: "bun test", purpose: "verification" },
          "verify behavior",
        ),
        turn({ type: "inspect_diff" }, "review changes"),
        turn({ type: "finish", summary: "Corrected addition and verified the test." }),
      ],
    });

    expect(result.status).toBe("verified");
    expect(result.changedFiles).toEqual(["src/math.ts"]);
    expect(result.recovery.failures).toEqual([
      expect.objectContaining({ kind: "patch", action: "apply_patch" }),
    ]);
    expect(await readFile(result.patchPath, "utf8")).toContain("return a + b");
  });

  test("recovers from bad patch syntax with exact text replacement", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "read_file", path: "src/math.ts" }, "inspect implementation"),
        turn({ type: "apply_patch", patch: "*** Begin Patch\n*** Update File: src/math.ts\n@@\n-  return a - b;\n+  return a + b;\n*** End Patch" }, "try non-git patch"),
        turn({
          type: "replace_text",
          path: "src/math.ts",
          search: "  return a - b;",
          replacement: "  return a + b;",
        }, "replace unique operator line after patch syntax failed"),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "inspect_diff" }),
        turn({ type: "finish", summary: "Corrected addition and verified." }),
      ],
    });

    expect(result.status).toBe("verified");
    expect(result.recovery.failures).toEqual([
      expect.objectContaining({ kind: "patch", action: "apply_patch" }),
    ]);
    expect(await readFile(result.patchPath, "utf8")).toContain("return a + b");
  });

  test("recovers from one invalid model response", async () => {
    const source = await codingFixture();
    const { result, model } = await runWithScript({
      source,
      script: [
        new ModelError("invalid_response", "missing action", false, 1),
        turn({ type: "finish", summary: "Could not complete." }),
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.metrics.modelCalls).toBe(1); // Invalid response was refunded from budget
    expect(model.requests[1]?.messages.at(-1)?.content).toContain("prior response was invalid");
  });

  test("stops at the step budget and still exports artifacts", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      maxSteps: 1,
      script: [
        turn({ type: "list_files", path: "." }),
        turn({ type: "finish", summary: "This turn must not run." }),
      ],
    });

    expect(result.status).toBe("budget_exhausted");
    expect(result.metrics).toMatchObject({ steps: 1, modelCalls: 1 });
    expect(await Bun.file(result.patchPath).exists()).toBeTrue();
    expect(await Bun.file(result.resultPath).exists()).toBeTrue();
    expect(await Bun.file(result.reportPath).exists()).toBeTrue();
  });

  test("does not accept a fabricated finish claim as verification", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [turn({ type: "finish", summary: "Everything passed." })],
    });

    expect(result.status).toBe("partial");
    expect(result.verification).toMatchObject({
      commandsRun: 0,
      successfulFinalState: false,
      lastResult: null,
    });
  });

  test("invalidates successful verification after a later edit", async () => {
    const source = await codingFixture();
    const secondPatch = FIX_PATCH.replace("-  return a - b;", "-  return a + b;").replace(
      "+  return a + b;",
      "+  return a * b;",
    );
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "apply_patch", patch: FIX_PATCH }),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "apply_patch", patch: secondPatch }),
        turn({ type: "finish", summary: "Claimed success after another edit." }),
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.verification.successfulFinalState).toBeFalse();
  });

  test("does not retain earlier success after a later verification failure", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "apply_patch", patch: FIX_PATCH }),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "run_command", command: "exit 9", purpose: "verification" }),
        turn({ type: "inspect_diff" }),
        turn({ type: "finish", summary: "The latest check failed." }),
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.verification).toMatchObject({
      commandsRun: 2,
      successfulFinalState: false,
      lastResult: { exitCode: 9 },
    });
  });

  test("does not treat a zero-test command as proof of a fix", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "apply_patch", patch: FIX_PATCH }),
        turn({ type: "run_command", command: "echo '0 tests'", purpose: "verification" }),
        turn({ type: "inspect_diff" }),
        turn({ type: "finish", summary: "No tests actually ran." }),
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.verification.evidence[0]?.status).toBe("unknown");
  });

  test("records a failed hypothesis, restores its checkpoint, and verifies a repair", async () => {
    const source = await codingFixture();
    const wrongPatch = FIX_PATCH.replace("+  return a + b;", "+  return a * b;");
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "create_checkpoint", label: "before multiplication hypothesis" }),
        turn({ type: "apply_patch", patch: wrongPatch }, "The operator should be multiplication."),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }, "Test multiplication hypothesis."),
        turn({ type: "restore_checkpoint", checkpointId: "latest" }, "Abandon multiplication hypothesis."),
        turn({ type: "apply_patch", patch: FIX_PATCH }, "Addition needs the plus operator."),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "inspect_diff" }),
        turn({ type: "finish", summary: "Repaired after one failed hypothesis." }),
      ],
    });
    expect(result.status).toBe("verified");
    expect(result.recovery).toMatchObject({ repairAttempts: 1, checkpointsCreated: 1, checkpointsRestored: 1 });
    expect(result.recovery.failures[0]).toMatchObject({ kind: "test", hypothesis: "Test multiplication hypothesis." });
  });

  test("stops after the bounded number of code-related failures", async () => {
    const source = await codingFixture();
    const wrongPatch = FIX_PATCH.replace("+  return a + b;", "+  return a * b;");
    const { result } = await runWithScript({
      source,
      maxRepairAttempts: 2,
      script: [
        turn({ type: "apply_patch", patch: wrongPatch }),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.terminationReason).toContain("Repair limit reached");
    expect(result.recovery.repairAttempts).toBe(2);
  });

  test("records setup failure without charging the code repair limit", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "run_command", command: "exit 2", purpose: "setup" }),
        turn({ type: "finish", summary: "Setup unavailable." }),
      ],
    });
    expect(result.recovery.repairAttempts).toBe(0);
    expect(result.recovery.failures[0]).toMatchObject({ kind: "setup", countsAgainstRepairLimit: false });
  });

  test("reuses unchanged reads and bypasses the cache after an edit", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "apply_patch", patch: FIX_PATCH }),
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "finish", summary: "Cache behavior inspected." }),
      ],
    });
    expect(result.memory).toMatchObject({ readCacheHits: 1, readCacheMisses: 2 });
    expect(result.status).toBe("partial");
  });

  test("terminates repeated unchanged actions at the stagnation limit", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      maxStagnationInterventions: 2,
      script: [
        turn({ type: "list_files", path: "." }),
        turn({ type: "list_files", path: "." }),
        turn({ type: "list_files", path: "." }),
      ],
    });
    expect(result.status).toBe("partial");
    expect(result.terminationReason).toContain("Stagnation limit");
    expect(result.metrics.stagnationInterventions).toBe(2);
  });

  test("does not treat the same read after an edit as stagnation", async () => {
    const source = await codingFixture();
    const { result } = await runWithScript({
      source,
      script: [
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "apply_patch", patch: FIX_PATCH }),
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "finish", summary: "Different repository states." }),
      ],
    });
    expect(result.metrics.stagnationInterventions).toBe(0);
  });

  test("bounds varied exploration that never changes code", async () => {
    const source = await codingFixture();
    const { result, model } = await runWithScript({
      source,
      maxSteps: 20,
      maxStagnationInterventions: 2,
      script: [
        ...Array.from({ length: 6 }, (_, index) =>
          turn({ type: "list_files" as const, path: ".", maxDepth: index + 1 })),
        turn({ type: "search", query: "add" }),
        turn({ type: "read_file", path: "src/math.ts" }),
      ],
    });

    expect(result.status).toBe("partial");
    expect(result.terminationReason).toContain("exploration without code changes");
    expect(result.metrics).toMatchObject({
      steps: 4,
      modelCalls: 6,
      stagnationInterventions: 2,
    });
    expect(model.requests[3]?.messages.map((message) => message.content).join("\n")).toContain(
      "Planning is complete",
    );
    expect(model.requests[4]?.messages.map((message) => message.content).join("\n")).toContain(
      "focused inspection phase is complete",
    );
  });

  test("blocks shell file-printing after prior unchanged inspection", async () => {
    const source = await codingFixture();
    const { result, model } = await runWithScript({
      source,
      maxStagnationInterventions: 2,
      script: [
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "search", query: "add" }),
        turn({ type: "run_command", command: "sed -n '1,80p' src/math.ts" }),
        turn({ type: "replace_file", path: "src/math.ts", content: "export function add(a: number, b: number): number {\n  return a + b;\n}\n" }),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "inspect_diff" }),
        turn({ type: "finish", summary: "Replaced stale implementation and verified." }),
      ],
    });

    expect(result.status).toBe("verified");
    expect(result.metrics.stagnationInterventions).toBe(1);
    expect(model.requests[3]?.messages.map((message) => message.content).join("\n")).toContain(
      "shell file-printing is wasting the edit budget",
    );
  });

  test("rejects exploration inside the final verification reserve without spending an action step", async () => {
    const source = await codingFixture();
    const { result, model } = await runWithScript({
      source,
      maxSteps: 6,
      verificationReserveSteps: 2,
      script: [
        turn({ type: "apply_patch", patch: FIX_PATCH }),
        turn({ type: "list_files", path: "src" }),
        turn({ type: "search", query: "add" }),
        turn({ type: "read_file", path: "src/math.ts" }),
        turn({ type: "run_command", command: "bun test", purpose: "verification" }),
        turn({ type: "inspect_diff" }),
        turn({ type: "finish", summary: "Used the protected verification capacity." }),
      ],
    });
    expect(result.status).toBe("verified");
    expect(result.metrics.verificationReserveActivations).toBe(1);
    expect(result.metrics.steps).toBe(5);
    expect(model.requests[3]?.messages.at(-1)?.content).toContain("Verification reserve is active");
  });

  test("includes the bounded repository map only when enabled", async () => {
    const source = await codingFixture();
    const { model } = await runWithScript({
      source,
      repositoryMapEnabled: true,
      script: [turn({ type: "finish", summary: "Map inspected." })],
    });
    expect(model.requests[0]?.messages[1]?.content).toContain('"path":"src/math.ts"');
  });
});
