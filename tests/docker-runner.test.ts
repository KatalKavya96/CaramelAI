import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DockerCommandRunner,
  buildDockerRunArguments,
  sanitizeContainerEnvironment,
  type DockerBackend,
  type RunningDockerProcess,
} from "../src/execution";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function stream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

class FakeDockerBackend implements DockerBackend {
  runArguments: readonly string[] | undefined;
  removedContainers: string[] = [];
  killed = false;

  constructor(
    private readonly output: {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      neverExit?: boolean;
      imageMissing?: boolean;
    } = {},
  ) {}

  async imageAvailable(): Promise<boolean> {
    return this.output.imageMissing !== true;
  }

  run(args: readonly string[]): RunningDockerProcess {
    this.runArguments = args;
    return {
      stdout: stream(this.output.stdout ?? ""),
      stderr: stream(this.output.stderr ?? ""),
      exited: this.output.neverExit
        ? new Promise<number>(() => {})
        : Promise.resolve(this.output.exitCode ?? 0),
      kill: () => {
        this.killed = true;
      },
    };
  }

  async removeForce(containerName: string): Promise<void> {
    this.removedContainers.push(containerName);
  }
}

async function runner(
  workspace: string,
  logs: string,
  backend: DockerBackend,
  options: { previewBytes?: number; maxLogBytes?: number } = {},
): Promise<DockerCommandRunner> {
  return await DockerCommandRunner.create(
    {
      workspacePath: workspace,
      logsPath: logs,
      defaultTimeoutMs: 50,
      maxTimeoutMs: 1_000,
      ...options,
    },
    { backend, commandId: () => "command-1", uid: 1_000, gid: 1_000 },
  );
}

describe("Docker command construction", () => {
  test("uses an unprivileged bounded container with one workspace mount", () => {
    const args = buildDockerRunArguments({
      containerName: "dinner-test",
      workspacePath: "/tmp/work space",
      containerCwd: "/workspace/src",
      image: "dinner-runner:0.1.0",
      command: "bun test",
      environment: sanitizeContainerEnvironment({ FEATURE_FLAG: "1" }),
      uid: 1_000,
      gid: 1_000,
      cpus: 2,
      memory: "2g",
      pidsLimit: 256,
      readOnlyMounts: [{ hostPath: "/tmp/evaluator", containerPath: "/dinner-inputs/evaluator" }],
    });

    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("ALL");
    expect(args).toContain("bridge");
    expect(args).toContain("/tmp/work space:/workspace:rw");
    expect(args).toContain("/tmp/evaluator:/dinner-inputs/evaluator:ro");
    expect(args).not.toContain("/var/run/docker.sock");
    expect(args.slice(-4)).toEqual(["dinner-runner:0.1.0", "/bin/sh", "-lc", "bun test"]);
  });

  test("can run commands with no network at all", () => {
    const args = buildDockerRunArguments({
      containerName: "dinner-test",
      workspacePath: "/tmp/work",
      containerCwd: "/workspace",
      image: "dinner-runner:0.1.0",
      command: "bun test",
      environment: sanitizeContainerEnvironment(),
      uid: 1_000,
      gid: 1_000,
      cpus: 2,
      memory: "2g",
      pidsLimit: 256,
      network: "none",
    });
    expect(args[args.indexOf("--network") + 1]).toBe("none");
  });

  test("blocks credential-like and runner-controlled environment variables", () => {
    expect(() => sanitizeContainerEnvironment({ AI_API_KEY: "do-not-forward" })).toThrow(
      "blocked as credential-like",
    );
    expect(() => sanitizeContainerEnvironment({ PATH: "/unsafe" })).toThrow(
      "controlled by the runner",
    );
  });
});

describe("DockerCommandRunner", () => {
  test("captures successful output and records command purpose", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    const backend = new FakeDockerBackend({ stdout: "passed\n", stderr: "warning\n" });
    const commandRunner = await runner(workspace, logs, backend);

    const result = await commandRunner.run({
      command: "bun test",
      purpose: "verification",
      env: { FEATURE_FLAG: "1" },
    });

    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      purpose: "verification",
      cwd: ".",
      stdout: { preview: "passed\n", previewTruncated: false },
      stderr: { preview: "warning\n", previewTruncated: false },
    });
    expect(await readFile(result.stdout.logPath, "utf8")).toBe("passed\n");
    expect(backend.runArguments?.join(" ")).not.toContain("AI_API_KEY");
  });

  test("preserves nonzero command exits as completed results", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    const commandRunner = await runner(
      workspace,
      logs,
      new FakeDockerBackend({ stderr: "failed\n", exitCode: 7 }),
    );

    const result = await commandRunner.run({ command: "exit 7", purpose: "agent" });
    expect(result).toMatchObject({ status: "completed", exitCode: 7 });
  });

  test("reports Docker's own failures as runner errors, not command failures", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    const commandRunner = await runner(
      workspace,
      logs,
      new FakeDockerBackend({ stderr: "docker: Error response from daemon: oops\n", exitCode: 125 }),
    );

    const result = await commandRunner.run({ command: "bun test", purpose: "verification" });
    expect(result).toMatchObject({ status: "runner_error", exitCode: null });
    expect(result.error).toContain("Error response from daemon");
  });

  test("fails fast when the runner image is missing", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    await expect(
      DockerCommandRunner.create(
        { workspacePath: workspace, logsPath: logs },
        { backend: new FakeDockerBackend({ imageMissing: true }) },
      ),
    ).rejects.toThrow("dinner-runner:0.1.0");
  });

  test("caps previews and logs while continuing to drain output", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    const commandRunner = await runner(
      workspace,
      logs,
      new FakeDockerBackend({ stdout: "abcdefghij" }),
      { previewBytes: 3, maxLogBytes: 5 },
    );

    const result = await commandRunner.run({ command: "produce output", purpose: "agent" });
    expect(result.stdout).toMatchObject({
      preview: "abc",
      previewTruncated: true,
      logTruncated: true,
      capturedBytes: 5,
    });
    expect(await readFile(result.stdout.logPath, "utf8")).toBe("abcde");
  });

  test("force-removes a timed-out container and kills the Docker client", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    const backend = new FakeDockerBackend({ neverExit: true });
    const commandRunner = await runner(workspace, logs, backend);

    const result = await commandRunner.run({ command: "sleep 30", purpose: "agent", timeoutMs: 10 });
    expect(result).toMatchObject({ status: "timed_out", exitCode: null });
    expect(backend.removedContainers).toEqual(["dinner-command-1"]);
    expect(backend.killed).toBeTrue();
  });

  test("rejects invalid and escaping working directories without launching Docker", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const outside = await temporaryDirectory("dinner-outside-");
    const logs = await temporaryDirectory("dinner-logs-");
    await mkdir(join(workspace, "src"));
    await symlink(outside, join(workspace, "escape"));
    const backend = new FakeDockerBackend();
    const commandRunner = await runner(workspace, logs, backend);

    const traversal = await commandRunner.run({ command: "pwd", purpose: "agent", cwd: "../" });
    expect(traversal).toMatchObject({ status: "runner_error", exitCode: null });
    const symlinkEscape = await commandRunner.run({ command: "pwd", purpose: "agent", cwd: "escape" });
    expect(symlinkEscape).toMatchObject({ status: "runner_error", exitCode: null });
    expect(backend.runArguments).toBeUndefined();
  });

  test("does not expose rejected environment values in errors", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    const backend = new FakeDockerBackend();
    const commandRunner = await runner(workspace, logs, backend);

    const result = await commandRunner.run({
      command: "env",
      purpose: "agent",
      env: { AI_API_KEY: "highly-sensitive-value" },
    });
    expect(result.status).toBe("runner_error");
    expect(JSON.stringify(result)).not.toContain("highly-sensitive-value");
    expect(backend.runArguments).toBeUndefined();
  });

  test("rejects log directories physically inside the workspace", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    await expect(
      DockerCommandRunner.create({
        workspacePath: workspace,
        logsPath: join(workspace, "new", "logs"),
      }),
    ).rejects.toThrow("outside the target workspace");
    expect(await Bun.file(join(workspace, "new")).exists()).toBeFalse();
  });

  test("rejects evaluator mounts inside the writable workspace", async () => {
    const workspace = await temporaryDirectory("dinner-workspace-");
    const logs = await temporaryDirectory("dinner-logs-");
    await mkdir(join(workspace, "evaluator"));
    await expect(
      DockerCommandRunner.create({
        workspacePath: workspace,
        logsPath: logs,
        readOnlyMounts: [
          { hostPath: join(workspace, "evaluator"), containerPath: "/dinner-inputs/evaluator" },
        ],
      }),
    ).rejects.toThrow("outside the target workspace");
  });
});

describe("Docker command cancellation", () => {
  test("removes the container and reports a runner error when the run is cancelled", async () => {
    const workspace = await temporaryDirectory("dinner-cancel-workspace-");
    const logs = await temporaryDirectory("dinner-cancel-logs-");
    const backend = new FakeDockerBackend({ neverExit: true });
    const commandRunner = await runner(workspace, logs, backend);
    const cancellation = new AbortController();
    setTimeout(() => cancellation.abort(), 5);

    const result = await commandRunner.run({
      command: "sleep 600",
      purpose: "agent",
      timeoutMs: 1_000,
      signal: cancellation.signal,
    });

    expect(result.status).toBe("runner_error");
    expect(result.error).toBe("Command cancelled.");
    expect(backend.removedContainers).toEqual(["dinner-command-1"]);
    expect(backend.killed).toBeTrue();
  });

  test("never starts a container once the run is already cancelled", async () => {
    const workspace = await temporaryDirectory("dinner-cancel-workspace-");
    const logs = await temporaryDirectory("dinner-cancel-logs-");
    const backend = new FakeDockerBackend();
    const cancellation = new AbortController();
    cancellation.abort();
    const result = await (await runner(workspace, logs, backend)).run({
      command: "bun test",
      purpose: "agent",
      signal: cancellation.signal,
    });
    expect(result.error).toBe("Command cancelled.");
    expect(backend.runArguments).toBeUndefined();
  });
});
