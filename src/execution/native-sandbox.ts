import { spawn } from "node:child_process";
import { constants } from "node:os";
import { access, lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import {
  CommandRunner,
  resolveRunnerLimits,
  type CommandNetwork,
  type CommandRunnerDependencies,
  type CommandRunnerOptions,
  type LaunchRequest,
  type LaunchedProcess,
  type Launcher,
} from "./command-runner";

/**
 * Runs commands on the user's own machine inside the operating system's sandbox, the way
 * Claude Code and Codex do: Seatbelt on macOS, bubblewrap on Linux. Compared with Docker it
 * uses the user's installed toolchain and needs no daemon, but it shares their kernel and user
 * account, so the rules below are what keeps a command away from the rest of the machine:
 *
 * - writes only to the run's workspace copy and a private home directory;
 * - no reads of credential stores (~/.ssh, cloud CLIs, keychains, browser profiles, …);
 * - network off unless the run allows it (loopback still works for tests that start servers);
 * - the whole process tree is killed on timeout or cancel.
 */

export type NativeSandboxKind = "seatbelt" | "bubblewrap";

export interface NativeRunnerOptions extends CommandRunnerOptions {
  network?: CommandNetwork;
  /** Writable HOME for commands. Defaults to a `sandbox-home` folder beside the logs. */
  homePath?: string;
  /** Extra host paths commands must not read, such as Caramel's own data folder. */
  denyRead?: readonly string[];
}

export interface NativeRunnerDependencies extends CommandRunnerDependencies {
  kind?: NativeSandboxKind;
  hostHome?: string;
  hostEnvironment?: Record<string, string | undefined>;
}

/** Credential and profile locations under the user's home that no command needs to read. */
export const CREDENTIAL_PATHS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".config/gh",
  ".config/hub",
  ".kube",
  ".docker",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".config/git/credentials",
  ".password-store",
  ".local/share/keyrings",
  ".claude",
  ".codex",
  ".mozilla",
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware",
  "Library/Keychains",
  "Library/Cookies",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Firefox",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Arc",
  "Library/Safari",
] as const;

/** Sockets that would hand a command the user's SSH keys or a root-equivalent Docker daemon. */
const LINUX_DENIED_SOCKET_PATHS = ["/run/user", "/var/run/docker.sock", "/run/docker.sock"] as const;

/**
 * Toolchain locations that live under the real home. HOME points at a private folder, so these
 * are passed through (read-only in practice) to keep nvm, pyenv, rustup and friends working.
 */
const TOOLCHAIN_VARIABLES: Record<string, string | null> = {
  NVM_DIR: ".nvm",
  PYENV_ROOT: ".pyenv",
  CARGO_HOME: ".cargo",
  RUSTUP_HOME: ".rustup",
  BUN_INSTALL: ".bun",
  VOLTA_HOME: ".volta",
  ASDF_DIR: null,
  ASDF_DATA_DIR: ".asdf",
  GOROOT: null,
  GOPATH: null,
  JAVA_HOME: null,
  SDKMAN_DIR: ".sdkman",
  DENO_INSTALL: ".deno",
  PNPM_HOME: null,
};

async function exists(path: string): Promise<boolean> {
  return await access(path).then(() => true, () => false);
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const number = signal === null ? undefined : constants.signals[signal];
  return 128 + (number ?? 9);
}

/** Starts a process in its own process group so the whole tree can be killed at once. */
function spawnGroup(argv: readonly string[], cwd: string, environment: Record<string, string>): LaunchedProcess {
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd,
    env: environment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const killGroup = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  const exited = new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", (error) => rejectExit(new Error(`Could not start the sandbox: ${error.message}`)));
    child.once("exit", (code, signal) => {
      // Background children would otherwise outlive the command and hold its output open.
      killGroup();
      resolveExit(code ?? signalExitCode(signal));
    });
  });
  return {
    stdout: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
    exited,
    kill: killGroup,
  };
}

/**
 * The Seatbelt profile. Starting from `allow default` and denying writes, credential reads and
 * network keeps ordinary tools working; a deny-default profile is stricter but has to list
 * every system service a compiler or test runner touches. The shared per-user temp folder
 * (/private/var/folders) stays read-only: Caramel's own runs live there. TMPDIR points into the
 * private home instead. Paths arrive as -D parameters, so
 * no path is ever spliced into the profile text. Later rules win in Seatbelt.
 */
export function seatbeltProfile(options: { denyCount: number; network: CommandNetwork }): string {
  const denied = Array.from({ length: options.denyCount }, (_, index) => `  (subpath (param "DENY_${index}"))`);
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    '  (subpath (param "WORKSPACE"))',
    '  (subpath (param "HOME_DIR"))',
    '  (literal "/dev/null")',
    '  (literal "/dev/zero")',
    '  (literal "/dev/dtracehelper")',
    '  (regex #"^/dev/tty")',
    '  (regex #"^/dev/fd/"))',
  ];
  if (denied.length > 0) lines.push("(deny file-read*", ...denied.map((line, index) => index === denied.length - 1 ? `${line})` : line));
  // Re-allow the workspace and home in case a denied folder contains them.
  lines.push('(allow file-read* (subpath (param "WORKSPACE")) (subpath (param "HOME_DIR")))');
  // Unix sockets reach local daemons (ssh-agent, Docker, keychain helpers), so none are allowed
  // except DNS when the network is on.
  lines.push("(deny network-outbound (remote unix-socket))");
  if (options.network === "none") {
    lines.push(
      "(deny network*)",
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    );
  } else {
    lines.push('(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))');
  }
  return `${lines.join("\n")}\n`;
}

export function seatbeltArguments(options: {
  workspacePath: string;
  homePath: string;
  denyRead: readonly string[];
  network: CommandNetwork;
  command: string;
}): string[] {
  const args = [
    "/usr/bin/sandbox-exec",
    "-D",
    `WORKSPACE=${options.workspacePath}`,
    "-D",
    `HOME_DIR=${options.homePath}`,
  ];
  options.denyRead.forEach((path, index) => args.push("-D", `DENY_${index}=${path}`));
  args.push(
    "-p",
    seatbeltProfile({ denyCount: options.denyRead.length, network: options.network }),
    "/bin/sh",
    "-c",
    options.command,
  );
  return args;
}

export function bubblewrapArguments(options: {
  workspacePath: string;
  homePath: string;
  cwd: string;
  /** Existing denied paths, split by kind: folders are hidden behind an empty tmpfs, files behind /dev/null. */
  deniedDirectories: readonly string[];
  deniedFiles: readonly string[];
  network: CommandNetwork;
  command: string;
}): string[] {
  const args = [
    "bwrap",
    "--die-with-parent",
    // A new session stops the command from injecting keystrokes into the user's terminal.
    "--new-session",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
  ];
  // A fresh network namespace has only loopback: tests can start local servers, nothing leaves.
  if (options.network === "none") args.push("--unshare-net");
  args.push("--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp");
  for (const directory of options.deniedDirectories) args.push("--tmpfs", directory);
  for (const file of options.deniedFiles) args.push("--ro-bind", "/dev/null", file);
  // Bound last so they stay writable even when a denied folder contains them.
  args.push(
    "--bind", options.workspacePath, options.workspacePath,
    "--bind", options.homePath, options.homePath,
    "--chdir", options.cwd,
    "/bin/sh", "-c", options.command,
  );
  return args;
}

async function runsCleanly(argv: readonly string[]): Promise<boolean> {
  try {
    const process = Bun.spawn([...argv], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const timeout = setTimeout(() => process.kill(), 10_000);
    try {
      return (await process.exited) === 0;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/** The native sandbox this machine can actually run, or null. Probes rather than trusting the OS name. */
export async function detectNativeSandbox(platform: NodeJS.Platform = process.platform): Promise<NativeSandboxKind | null> {
  if (platform === "darwin") {
    return (await runsCleanly(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"])) ? "seatbelt" : null;
  }
  if (platform === "linux") {
    // Ubuntu 24.04+ blocks the user namespaces bubblewrap needs unless AppArmor allows it.
    return (await runsCleanly(["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--unshare-net", "--die-with-parent", "true"]))
      ? "bubblewrap"
      : null;
  }
  return null;
}

export const NATIVE_SANDBOX_HELP: Record<string, string> = {
  darwin: "macOS's sandbox-exec did not run.",
  linux:
    "Install bubblewrap (`sudo apt install bubblewrap` or `sudo dnf install bubblewrap`). On Ubuntu 24.04+, also allow unprivileged user namespaces for bwrap in AppArmor.",
  win32: "Windows has no native sandbox support yet. Use Docker Desktop or run Caramel inside WSL2.",
};

class NativeLauncher implements Launcher {
  readonly label: string;

  constructor(
    private readonly kind: NativeSandboxKind,
    private readonly options: {
      workspacePath: string;
      homePath: string;
      network: CommandNetwork;
      deniedDirectories: readonly string[];
      deniedFiles: readonly string[];
    },
  ) {
    this.label = `native:${kind}`;
  }

  launch(request: LaunchRequest): LaunchedProcess {
    const cwd = request.relativeCwd === "" ? this.options.workspacePath : resolve(this.options.workspacePath, request.relativeCwd);
    const argv = this.kind === "seatbelt"
      ? seatbeltArguments({
          workspacePath: this.options.workspacePath,
          homePath: this.options.homePath,
          denyRead: [...this.options.deniedDirectories, ...this.options.deniedFiles],
          network: this.options.network,
          command: request.command,
        })
      : bubblewrapArguments({
          workspacePath: this.options.workspacePath,
          homePath: this.options.homePath,
          cwd,
          deniedDirectories: this.options.deniedDirectories,
          deniedFiles: this.options.deniedFiles,
          network: this.options.network,
          command: request.command,
        });
    return spawnGroup(argv, cwd, request.environment);
  }

  async stop(_request: LaunchRequest, process: LaunchedProcess): Promise<void> {
    process.kill();
  }
}

/** The environment base for native commands: the user's PATH and toolchains, a private HOME, nothing else. */
export function nativeEnvironmentBase(
  hostEnvironment: Record<string, string | undefined>,
  hostHome: string,
  homePath: string,
  existingToolchainDefaults: ReadonlySet<string>,
): Record<string, string> {
  // The host environment is NOT inherited: it may hold model API keys and tokens.
  const base: Record<string, string> = {
    PATH: hostEnvironment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: homePath,
    TMPDIR: resolve(homePath, "tmp"),
  };
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "SHELL", "USER", "LOGNAME"]) {
    const value = hostEnvironment[name];
    if (value !== undefined) base[name] = value;
  }
  for (const [name, defaultPath] of Object.entries(TOOLCHAIN_VARIABLES)) {
    const value = hostEnvironment[name];
    if (value !== undefined) base[name] = value;
    else if (defaultPath !== null && existingToolchainDefaults.has(name)) base[name] = resolve(hostHome, defaultPath);
  }
  return base;
}

async function canonicalExisting(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

export const NativeCommandRunner = {
  async create(options: NativeRunnerOptions, dependencies: NativeRunnerDependencies = {}): Promise<CommandRunner> {
    const kind = dependencies.kind ?? (await detectNativeSandbox());
    if (kind === null) {
      throw new Error(`No native sandbox is available. ${NATIVE_SANDBOX_HELP[process.platform] ?? ""}`.trim());
    }
    const limits = await resolveRunnerLimits(options);
    const homeTarget = resolve(options.homePath ?? resolve(dirname(limits.logsPath), "sandbox-home"));
    await mkdir(resolve(homeTarget, "tmp"), { recursive: true });
    const homePath = await realpath(homeTarget);

    const hostHome = dependencies.hostHome ?? homedir();
    const hostEnvironment = dependencies.hostEnvironment ?? process.env;
    const deniedDirectories: string[] = [];
    const deniedFiles: string[] = [];
    const candidates = [
      ...CREDENTIAL_PATHS.map((path) => resolve(hostHome, path)),
      ...(kind === "bubblewrap" ? LINUX_DENIED_SOCKET_PATHS : []),
      ...(options.denyRead ?? []),
    ];
    for (const candidate of candidates) {
      // Sandboxes match canonical paths; a symlinked ~/.ssh must be denied where it really lives.
      const canonical = await canonicalExisting(candidate);
      if (canonical === null) continue;
      if ((await lstat(canonical)).isDirectory()) deniedDirectories.push(canonical);
      else deniedFiles.push(canonical);
    }

    const toolchainDefaults = new Set<string>();
    for (const [name, path] of Object.entries(TOOLCHAIN_VARIABLES)) {
      if (path !== null && (await exists(resolve(hostHome, path)))) toolchainDefaults.add(name);
    }
    const launcher = new NativeLauncher(kind, {
      workspacePath: limits.workspacePath,
      homePath,
      network: options.network ?? "none",
      deniedDirectories,
      deniedFiles,
    });
    return new CommandRunner(
      limits,
      launcher,
      nativeEnvironmentBase(hostEnvironment, hostHome, homePath, toolchainDefaults),
      dependencies,
    );
  },
};
