import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DockerCliBackend, type DockerBackend, type RunningDockerProcess } from "./docker-backend";
import type { CommandOutput, CommandRequest, CommandResult } from "./types";

export interface DockerRunnerOptions {
  workspacePath: string;
  logsPath: string;
  image?: string;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  previewBytes?: number;
  maxLogBytes?: number;
  cpus?: number;
  memory?: string;
  pidsLimit?: number;
  /** "bridge" allows package installs; "none" blocks all network access, including exfiltration. */
  network?: CommandNetwork;
  readOnlyMounts?: readonly { hostPath: string; containerPath: string }[];
}

export type CommandNetwork = "bridge" | "none";

interface DockerRunnerDependencies {
  backend?: DockerBackend;
  now?: () => number;
  commandId?: () => string;
  uid?: number;
  gid?: number;
}

interface NormalizedDockerRunnerOptions {
  workspacePath: string;
  logsPath: string;
  image: string;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  previewBytes: number;
  maxLogBytes: number;
  cpus: number;
  memory: string;
  pidsLimit: number;
  network: CommandNetwork;
  readOnlyMounts: readonly { hostPath: string; containerPath: string }[];
}

const DEFAULT_OPTIONS = {
  image: "dinner-runner:0.1.0",
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 20 * 60_000,
  previewBytes: 64 * 1024,
  maxLogBytes: 10 * 1024 * 1024,
  cpus: 2,
  memory: "2g",
  pidsLimit: 256,
} as const;

// `docker run` exits 125 when Docker itself fails (daemon error, missing image, bad flags),
// before the command starts. That is an infrastructure failure, not a failing test.
const DOCKER_RUN_FAILURE_EXIT = 125;

const RESERVED_ENVIRONMENT = new Set(["HOME", "PATH", "CI", "NO_COLOR", "TERM", "TMPDIR"]);
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

class CommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandValidationError";
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missingSegments: string[] = [];
  while (!(await pathExists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    missingSegments.unshift(basename(ancestor));
    ancestor = parent;
  }
  return resolve(await realpath(ancestor), ...missingSegments);
}

export function sanitizeContainerEnvironment(
  environment: Record<string, string> = {},
): Record<string, string> {
  const sanitized: Record<string, string> = {
    CI: "1",
    NO_COLOR: "1",
    HOME: "/tmp/dinner-home",
    TMPDIR: "/tmp",
  };

  for (const [name, value] of Object.entries(environment)) {
    if (!ENVIRONMENT_NAME.test(name)) {
      throw new CommandValidationError(`Invalid environment variable name: ${name}`);
    }
    if (RESERVED_ENVIRONMENT.has(name)) {
      throw new CommandValidationError(`Environment variable ${name} is controlled by the runner.`);
    }
    if (SECRET_NAME.test(name)) {
      throw new CommandValidationError(`Environment variable ${name} is blocked as credential-like.`);
    }
    if (value.includes("\0")) {
      throw new CommandValidationError(`Environment variable ${name} contains a null byte.`);
    }
    sanitized[name] = value;
  }
  return sanitized;
}

export function buildDockerRunArguments(options: {
  containerName: string;
  workspacePath: string;
  containerCwd: string;
  image: string;
  command: string;
  environment: Record<string, string>;
  uid: number;
  gid: number;
  cpus: number;
  memory: string;
  pidsLimit: number;
  network?: CommandNetwork;
  readOnlyMounts?: readonly { hostPath: string; containerPath: string }[];
}): string[] {
  const args = [
    "run",
    "--rm",
    "--init",
    "--name",
    options.containerName,
    "--network",
    options.network ?? "bridge",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=512m",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--cpus",
    String(options.cpus),
    "--memory",
    options.memory,
    "--pids-limit",
    String(options.pidsLimit),
    "--user",
    `${options.uid}:${options.gid}`,
    "--volume",
    `${options.workspacePath}:/workspace:rw`,
    "--workdir",
    options.containerCwd,
  ];
  for (const mount of options.readOnlyMounts ?? []) {
    args.push("--volume", `${mount.hostPath}:${mount.containerPath}:ro`);
  }
  for (const [name, value] of Object.entries(options.environment).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    args.push("--env", `${name}=${value}`);
  }
  args.push(options.image, "/bin/sh", "-lc", options.command);
  return args;
}

async function captureToFile(
  stream: ReadableStream<Uint8Array>,
  logPath: string,
  previewLimit: number,
  logLimit: number,
): Promise<CommandOutput> {
  const reader = stream.getReader();
  const log = createWriteStream(logPath, { flags: "wx" });
  const previewChunks: Uint8Array[] = [];
  let previewBytes = 0;
  let capturedBytes = 0;
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;

      if (capturedBytes < logLimit) {
        const keptForLog = value.subarray(0, logLimit - capturedBytes);
        capturedBytes += keptForLog.byteLength;
        if (!log.write(keptForLog)) await once(log, "drain");
      }
      if (previewBytes < previewLimit) {
        const keptForPreview = value.subarray(0, previewLimit - previewBytes);
        previewChunks.push(keptForPreview);
        previewBytes += keptForPreview.byteLength;
      }
    }
  } finally {
    log.end();
    await once(log, "finish");
  }

  return {
    preview: Buffer.concat(previewChunks).toString("utf8"),
    previewTruncated: totalBytes > previewBytes,
    logPath,
    logTruncated: totalBytes > capturedBytes,
    capturedBytes,
  };
}

export class DockerCommandRunner {
  private constructor(
    private readonly options: NormalizedDockerRunnerOptions,
    private readonly backend: DockerBackend,
    private readonly now: () => number,
    private readonly nextCommandId: () => string,
    private readonly uid: number,
    private readonly gid: number,
  ) {}

  static async create(
    options: DockerRunnerOptions,
    dependencies: DockerRunnerDependencies = {},
  ): Promise<DockerCommandRunner> {
    const workspacePath = await realpath(resolve(options.workspacePath));
    if (!(await stat(workspacePath)).isDirectory()) throw new Error("workspacePath must be a directory.");
    const logsPath = await canonicalizeProspectivePath(options.logsPath);
    if (isInside(workspacePath, logsPath)) {
      throw new Error("logsPath must be outside the target workspace.");
    }
    await mkdir(logsPath, { recursive: true });

    const defaultTimeoutMs = positiveInteger(
      options.defaultTimeoutMs ?? DEFAULT_OPTIONS.defaultTimeoutMs,
      "defaultTimeoutMs",
    );
    const maxTimeoutMs = positiveInteger(
      options.maxTimeoutMs ?? DEFAULT_OPTIONS.maxTimeoutMs,
      "maxTimeoutMs",
    );
    if (defaultTimeoutMs > maxTimeoutMs) {
      throw new Error("defaultTimeoutMs must not exceed maxTimeoutMs.");
    }
    const readOnlyMounts: { hostPath: string; containerPath: string }[] = [];
    for (const mount of options.readOnlyMounts ?? []) {
      const hostPath = await realpath(resolve(mount.hostPath));
      if (isInside(workspacePath, hostPath)) {
        throw new Error("Read-only mounts must be outside the target workspace.");
      }
      if (!/^\/dinner-inputs\/[A-Za-z0-9_.-]+$/.test(mount.containerPath)) {
        throw new Error("Read-only container paths must be direct children of /dinner-inputs.");
      }
      readOnlyMounts.push({ hostPath, containerPath: mount.containerPath });
    }

    const image = options.image ?? DEFAULT_OPTIONS.image;
    const backend = dependencies.backend ?? new DockerCliBackend();
    if (!(await backend.imageAvailable(image))) {
      throw new Error(
        `Docker image ${image} is unavailable. Start Docker and build the runner image with \`make setup\`.`,
      );
    }

    return new DockerCommandRunner(
      {
        workspacePath,
        logsPath,
        image,
        defaultTimeoutMs,
        maxTimeoutMs,
        previewBytes: positiveInteger(options.previewBytes ?? DEFAULT_OPTIONS.previewBytes, "previewBytes"),
        maxLogBytes: positiveInteger(options.maxLogBytes ?? DEFAULT_OPTIONS.maxLogBytes, "maxLogBytes"),
        cpus: positiveNumber(options.cpus ?? DEFAULT_OPTIONS.cpus, "cpus"),
        memory: options.memory ?? DEFAULT_OPTIONS.memory,
        pidsLimit: positiveInteger(options.pidsLimit ?? DEFAULT_OPTIONS.pidsLimit, "pidsLimit"),
        network: options.network ?? "bridge",
        readOnlyMounts,
      },
      backend,
      dependencies.now ?? Date.now,
      dependencies.commandId ?? (() => crypto.randomUUID()),
      dependencies.uid ?? process.getuid?.() ?? 1_000,
      dependencies.gid ?? process.getgid?.() ?? 1_000,
    );
  }

  async run(request: CommandRequest): Promise<CommandResult> {
    const commandId = this.nextCommandId().replace(/[^a-zA-Z0-9_.-]/g, "-") || crypto.randomUUID();
    const stdoutPath = resolve(this.options.logsPath, `${commandId}.stdout.log`);
    const stderrPath = resolve(this.options.logsPath, `${commandId}.stderr.log`);
    const startedAt = this.now();
    const containerName = `dinner-${commandId}`;
    let runningProcess: RunningDockerProcess | undefined;

    try {
      const validated = await this.validateRequest(request);
      const args = buildDockerRunArguments({
        containerName,
        workspacePath: this.options.workspacePath,
        containerCwd: validated.containerCwd,
        image: this.options.image,
        command: request.command,
        environment: validated.environment,
        uid: this.uid,
        gid: this.gid,
        cpus: this.options.cpus,
        memory: this.options.memory,
        pidsLimit: this.options.pidsLimit,
        network: this.options.network,
        readOnlyMounts: this.options.readOnlyMounts,
      });
      const process = this.backend.run(args);
      runningProcess = process;
      const stdout = captureToFile(
        process.stdout,
        stdoutPath,
        this.options.previewBytes,
        this.options.maxLogBytes,
      );
      const stderr = captureToFile(
        process.stderr,
        stderrPath,
        this.options.previewBytes,
        this.options.maxLogBytes,
      );
      const completion = await this.waitForCompletion(
        process,
        containerName,
        validated.timeoutMs,
      );
      const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
      if (!completion.timedOut && completion.exitCode === DOCKER_RUN_FAILURE_EXIT) {
        return {
          commandId,
          command: request.command,
          purpose: request.purpose,
          cwd: validated.cwd,
          image: this.options.image,
          status: "runner_error",
          exitCode: null,
          durationMs: Math.max(0, this.now() - startedAt),
          timeoutMs: validated.timeoutMs,
          stdout: stdoutResult,
          stderr: stderrResult,
          error: stderrResult.preview.trim() || "docker run failed before the command started.",
        };
      }

      return {
        commandId,
        command: request.command,
        purpose: request.purpose,
        cwd: validated.cwd,
        image: this.options.image,
        status: completion.timedOut ? "timed_out" : "completed",
        exitCode: completion.exitCode,
        durationMs: Math.max(0, this.now() - startedAt),
        timeoutMs: validated.timeoutMs,
        stdout: stdoutResult,
        stderr: stderrResult,
      };
    } catch (error) {
      if (runningProcess !== undefined) {
        try {
          await this.backend.removeForce(containerName);
        } catch {
          // Preserve the original runner error; cleanup remains best effort.
        } finally {
          runningProcess.kill();
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      await Promise.all([writeFile(stdoutPath, "", { flag: "a" }), writeFile(stderrPath, "", { flag: "a" })]);
      return {
        commandId,
        command: request.command,
        purpose: request.purpose,
        cwd: request.cwd ?? ".",
        image: this.options.image,
        status: "runner_error",
        exitCode: null,
        durationMs: Math.max(0, this.now() - startedAt),
        timeoutMs: this.safeTimeoutForResult(request.timeoutMs),
        stdout: this.emptyOutput(stdoutPath),
        stderr: this.emptyOutput(stderrPath),
        error: detail,
      };
    }
  }

  private safeTimeoutForResult(requestedTimeout: number | undefined): number {
    if (
      requestedTimeout === undefined ||
      !Number.isInteger(requestedTimeout) ||
      requestedTimeout <= 0
    ) {
      return this.options.defaultTimeoutMs;
    }
    return Math.min(requestedTimeout, this.options.maxTimeoutMs);
  }

  private async validateRequest(request: CommandRequest): Promise<{
    cwd: string;
    containerCwd: string;
    timeoutMs: number;
    environment: Record<string, string>;
  }> {
    if (request.command.trim() === "") throw new CommandValidationError("Command must not be empty.");
    const cwd = request.cwd ?? ".";
    if (cwd.trim() === "" || isAbsolute(cwd)) {
      throw new CommandValidationError("Command cwd must be a relative workspace path.");
    }
    const lexicalCwd = resolve(this.options.workspacePath, cwd);
    if (!isInside(this.options.workspacePath, lexicalCwd)) {
      throw new CommandValidationError(`Command cwd escapes the workspace: ${cwd}`);
    }
    let canonicalCwd: string;
    try {
      canonicalCwd = await realpath(lexicalCwd);
    } catch {
      throw new CommandValidationError(`Command cwd does not exist: ${cwd}`);
    }
    if (!isInside(this.options.workspacePath, canonicalCwd)) {
      throw new CommandValidationError(`Command cwd symlink escapes the workspace: ${cwd}`);
    }
    if (!(await stat(canonicalCwd)).isDirectory()) {
      throw new CommandValidationError(`Command cwd is not a directory: ${cwd}`);
    }
    const relativeCwd = relative(this.options.workspacePath, canonicalCwd).split(sep).join("/");
    const requestedTimeout = positiveInteger(
      request.timeoutMs ?? this.options.defaultTimeoutMs,
      "timeoutMs",
    );
    return {
      cwd: relativeCwd || ".",
      containerCwd: relativeCwd === "" ? "/workspace" : `/workspace/${relativeCwd}`,
      timeoutMs: Math.min(requestedTimeout, this.options.maxTimeoutMs),
      environment: sanitizeContainerEnvironment(request.env),
    };
  }

  private async waitForCompletion(
    process: RunningDockerProcess,
    containerName: string,
    timeoutMs: number,
  ): Promise<{ exitCode: number | null; timedOut: boolean }> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ exitCode: null; timedOut: true }>((resolveTimeout) => {
      timeoutHandle = setTimeout(async () => {
        try {
          await this.backend.removeForce(containerName);
        } finally {
          process.kill();
          resolveTimeout({ exitCode: null, timedOut: true });
        }
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        process.exited.then((exitCode) => ({ exitCode, timedOut: false as const })),
        timeout,
      ]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  private emptyOutput(logPath: string): CommandOutput {
    return {
      preview: "",
      previewTruncated: false,
      logPath,
      logTruncated: false,
      capturedBytes: 0,
    };
  }
}
