import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CommandOutput, CommandRequest, CommandResult } from "./types";

/**
 * The shared half of every runner: validating a request, capturing output to capped logs,
 * timeouts and cancellation. How the command is isolated (a Docker container, macOS Seatbelt,
 * Linux bubblewrap) is a Launcher's job.
 */

export const CANCELLED_MESSAGE = "Command cancelled.";

/** "bridge" allows package installs; "none" blocks all network access, including exfiltration. */
export type CommandNetwork = "bridge" | "none";

export interface LaunchedProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export interface LaunchRequest {
  id: string;
  command: string;
  /** Workspace-relative working directory, "" for the root. */
  relativeCwd: string;
  environment: Record<string, string>;
}

export interface Launcher {
  /** Recorded as CommandResult.image so evidence says where a command ran. */
  readonly label: string;
  launch(request: LaunchRequest): LaunchedProcess;
  /** Stops the command and everything it started. Must be safe to call after it exited. */
  stop(request: LaunchRequest, process: LaunchedProcess): Promise<void>;
  /** An error message when this exit code means the launcher failed before the command ran. */
  launchFailure?(exitCode: number, stderrPreview: string): string | null;
}

export interface CommandRunnerOptions {
  workspacePath: string;
  logsPath: string;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  previewBytes?: number;
  maxLogBytes?: number;
}

export interface CommandRunnerDependencies {
  now?: () => number;
  commandId?: () => string;
}

export interface CommandRunnerLimits {
  workspacePath: string;
  logsPath: string;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  previewBytes: number;
  maxLogBytes: number;
}

const DEFAULT_LIMITS = {
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 20 * 60_000,
  previewBytes: 64 * 1024,
  maxLogBytes: 10 * 1024 * 1024,
} as const;

const RESERVED_ENVIRONMENT = new Set(["HOME", "PATH", "CI", "NO_COLOR", "TERM", "TMPDIR"]);
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class CommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandValidationError";
  }
}

export function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

export function isInside(root: string, candidate: string): boolean {
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

export async function canonicalizeProspectivePath(path: string): Promise<string> {
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

/**
 * The environment a command sees: runner-controlled basics plus the request's variables.
 * Credential-like names are refused so the agent cannot route a secret into a command.
 */
export function sanitizeCommandEnvironment(
  environment: Record<string, string> = {},
  base: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = { CI: "1", NO_COLOR: "1", ...base };
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

/** Canonical workspace and logs paths plus validated limits, shared by every runner factory. */
export async function resolveRunnerLimits(options: CommandRunnerOptions): Promise<CommandRunnerLimits> {
  const workspacePath = await realpath(resolve(options.workspacePath));
  if (!(await stat(workspacePath)).isDirectory()) throw new Error("workspacePath must be a directory.");
  const logsPath = await canonicalizeProspectivePath(options.logsPath);
  if (isInside(workspacePath, logsPath)) {
    throw new Error("logsPath must be outside the target workspace.");
  }
  await mkdir(logsPath, { recursive: true });

  const defaultTimeoutMs = positiveInteger(
    options.defaultTimeoutMs ?? DEFAULT_LIMITS.defaultTimeoutMs,
    "defaultTimeoutMs",
  );
  const maxTimeoutMs = positiveInteger(options.maxTimeoutMs ?? DEFAULT_LIMITS.maxTimeoutMs, "maxTimeoutMs");
  if (defaultTimeoutMs > maxTimeoutMs) {
    throw new Error("defaultTimeoutMs must not exceed maxTimeoutMs.");
  }
  return {
    workspacePath,
    logsPath,
    defaultTimeoutMs,
    maxTimeoutMs,
    previewBytes: positiveInteger(options.previewBytes ?? DEFAULT_LIMITS.previewBytes, "previewBytes"),
    maxLogBytes: positiveInteger(options.maxLogBytes ?? DEFAULT_LIMITS.maxLogBytes, "maxLogBytes"),
  };
}

export class CommandRunner {
  private readonly now: () => number;
  private readonly nextCommandId: () => string;

  constructor(
    private readonly limits: CommandRunnerLimits,
    private readonly launcher: Launcher,
    private readonly environmentBase: Record<string, string>,
    dependencies: CommandRunnerDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.nextCommandId = dependencies.commandId ?? (() => crypto.randomUUID());
  }

  async run(request: CommandRequest): Promise<CommandResult> {
    const commandId = this.nextCommandId().replace(/[^a-zA-Z0-9_.-]/g, "-") || crypto.randomUUID();
    const stdoutPath = resolve(this.limits.logsPath, `${commandId}.stdout.log`);
    const stderrPath = resolve(this.limits.logsPath, `${commandId}.stderr.log`);
    const startedAt = this.now();
    let launched: { request: LaunchRequest; process: LaunchedProcess } | undefined;

    try {
      if (request.signal?.aborted === true) throw new Error(CANCELLED_MESSAGE);
      const validated = await this.validateRequest(request);
      const launchRequest: LaunchRequest = {
        id: commandId,
        command: request.command,
        relativeCwd: validated.relativeCwd,
        environment: validated.environment,
      };
      const process = this.launcher.launch(launchRequest);
      launched = { request: launchRequest, process };
      const stdout = captureToFile(process.stdout, stdoutPath, this.limits.previewBytes, this.limits.maxLogBytes);
      const stderr = captureToFile(process.stderr, stderrPath, this.limits.previewBytes, this.limits.maxLogBytes);
      const completion = await this.waitForCompletion(launchRequest, process, validated.timeoutMs, request.signal);
      const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
      const result = {
        commandId,
        command: request.command,
        purpose: request.purpose,
        cwd: validated.cwd,
        image: this.launcher.label,
        durationMs: Math.max(0, this.now() - startedAt),
        timeoutMs: validated.timeoutMs,
        stdout: stdoutResult,
        stderr: stderrResult,
      };
      if (completion.cancelled) {
        return { ...result, status: "runner_error", exitCode: null, error: CANCELLED_MESSAGE };
      }
      const launchFailure = !completion.timedOut && completion.exitCode !== null
        ? this.launcher.launchFailure?.(completion.exitCode, stderrResult.preview) ?? null
        : null;
      if (launchFailure !== null) {
        return { ...result, status: "runner_error", exitCode: null, error: launchFailure };
      }
      return {
        ...result,
        status: completion.timedOut ? "timed_out" : "completed",
        exitCode: completion.exitCode,
      };
    } catch (error) {
      if (launched !== undefined) {
        try {
          await this.launcher.stop(launched.request, launched.process);
        } catch {
          // Preserve the original runner error; cleanup remains best effort.
        }
      }
      const detail = error instanceof Error ? error.message : String(error);
      await Promise.all([writeFile(stdoutPath, "", { flag: "a" }), writeFile(stderrPath, "", { flag: "a" })]);
      return {
        commandId,
        command: request.command,
        purpose: request.purpose,
        cwd: request.cwd ?? ".",
        image: this.launcher.label,
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
    if (requestedTimeout === undefined || !Number.isInteger(requestedTimeout) || requestedTimeout <= 0) {
      return this.limits.defaultTimeoutMs;
    }
    return Math.min(requestedTimeout, this.limits.maxTimeoutMs);
  }

  private async validateRequest(request: CommandRequest): Promise<{
    cwd: string;
    relativeCwd: string;
    timeoutMs: number;
    environment: Record<string, string>;
  }> {
    if (request.command.trim() === "") throw new CommandValidationError("Command must not be empty.");
    const cwd = request.cwd ?? ".";
    if (cwd.trim() === "" || isAbsolute(cwd)) {
      throw new CommandValidationError("Command cwd must be a relative workspace path.");
    }
    const lexicalCwd = resolve(this.limits.workspacePath, cwd);
    if (!isInside(this.limits.workspacePath, lexicalCwd)) {
      throw new CommandValidationError(`Command cwd escapes the workspace: ${cwd}`);
    }
    let canonicalCwd: string;
    try {
      canonicalCwd = await realpath(lexicalCwd);
    } catch {
      throw new CommandValidationError(`Command cwd does not exist: ${cwd}`);
    }
    if (!isInside(this.limits.workspacePath, canonicalCwd)) {
      throw new CommandValidationError(`Command cwd symlink escapes the workspace: ${cwd}`);
    }
    if (!(await stat(canonicalCwd)).isDirectory()) {
      throw new CommandValidationError(`Command cwd is not a directory: ${cwd}`);
    }
    const relativeCwd = relative(this.limits.workspacePath, canonicalCwd).split(sep).join("/");
    const requestedTimeout = positiveInteger(request.timeoutMs ?? this.limits.defaultTimeoutMs, "timeoutMs");
    return {
      cwd: relativeCwd || ".",
      relativeCwd,
      timeoutMs: Math.min(requestedTimeout, this.limits.maxTimeoutMs),
      environment: sanitizeCommandEnvironment(request.env, this.environmentBase),
    };
  }

  private async waitForCompletion(
    request: LaunchRequest,
    process: LaunchedProcess,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ exitCode: number | null; timedOut: boolean; cancelled: boolean }> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stop = () => this.launcher.stop(request, process).catch(() => undefined);
    const timeout = new Promise<{ exitCode: null; timedOut: true; cancelled: false }>((resolveTimeout) => {
      timeoutHandle = setTimeout(() => {
        void stop().finally(() => resolveTimeout({ exitCode: null, timedOut: true, cancelled: false }));
      }, timeoutMs);
    });
    const cancelled = new Promise<{ exitCode: null; timedOut: false; cancelled: true }>((resolveCancel) => {
      if (signal === undefined) return;
      onAbort = () => {
        void stop().finally(() => resolveCancel({ exitCode: null, timedOut: false, cancelled: true }));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      return await Promise.race([
        process.exited.then((exitCode) => ({ exitCode, timedOut: false, cancelled: false })),
        timeout,
        cancelled,
      ]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    }
  }

  private emptyOutput(logPath: string): CommandOutput {
    return { preview: "", previewTruncated: false, logPath, logTruncated: false, capturedBytes: 0 };
  }
}
