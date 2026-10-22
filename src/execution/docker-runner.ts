import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CommandRunner,
  isInside,
  positiveInteger,
  positiveNumber,
  resolveRunnerLimits,
  sanitizeCommandEnvironment,
  type CommandNetwork,
  type CommandRunnerDependencies,
  type CommandRunnerOptions,
  type LaunchRequest,
  type LaunchedProcess,
  type Launcher,
} from "./command-runner";
import { DockerCliBackend, type DockerBackend } from "./docker-backend";

export interface DockerRunnerOptions extends CommandRunnerOptions {
  image?: string;
  cpus?: number;
  memory?: string;
  pidsLimit?: number;
  /** "bridge" allows package installs; "none" blocks all network access, including exfiltration. */
  network?: CommandNetwork;
  readOnlyMounts?: readonly { hostPath: string; containerPath: string }[];
}

interface DockerRunnerDependencies extends CommandRunnerDependencies {
  backend?: DockerBackend;
  uid?: number;
  gid?: number;
}

const DEFAULT_OPTIONS = {
  image: "dinner-runner:0.1.0",
  cpus: 2,
  memory: "2g",
  pidsLimit: 256,
} as const;

// `docker run` exits 125 when Docker itself fails (daemon error, missing image, bad flags),
// before the command starts. That is an infrastructure failure, not a failing test.
const DOCKER_RUN_FAILURE_EXIT = 125;

const CONTAINER_HOME = "/tmp/dinner-home";

export function sanitizeContainerEnvironment(
  environment: Record<string, string> = {},
): Record<string, string> {
  return sanitizeCommandEnvironment(environment, { HOME: CONTAINER_HOME, TMPDIR: "/tmp" });
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

class DockerLauncher implements Launcher {
  readonly label: string;

  constructor(
    private readonly options: {
      workspacePath: string;
      image: string;
      cpus: number;
      memory: string;
      pidsLimit: number;
      network: CommandNetwork;
      readOnlyMounts: readonly { hostPath: string; containerPath: string }[];
      uid: number;
      gid: number;
    },
    private readonly backend: DockerBackend,
  ) {
    this.label = options.image;
  }

  private containerName(request: LaunchRequest): string {
    return `dinner-${request.id}`;
  }

  launch(request: LaunchRequest): LaunchedProcess {
    return this.backend.run(
      buildDockerRunArguments({
        containerName: this.containerName(request),
        workspacePath: this.options.workspacePath,
        containerCwd: request.relativeCwd === "" ? "/workspace" : `/workspace/${request.relativeCwd}`,
        image: this.options.image,
        command: request.command,
        environment: request.environment,
        uid: this.options.uid,
        gid: this.options.gid,
        cpus: this.options.cpus,
        memory: this.options.memory,
        pidsLimit: this.options.pidsLimit,
        network: this.options.network,
        readOnlyMounts: this.options.readOnlyMounts,
      }),
    );
  }

  // Killing the docker CLI alone leaves the container running, so the container goes first.
  async stop(request: LaunchRequest, process: LaunchedProcess): Promise<void> {
    try {
      await this.backend.removeForce(this.containerName(request));
    } finally {
      process.kill();
    }
  }

  launchFailure(exitCode: number, stderrPreview: string): string | null {
    if (exitCode !== DOCKER_RUN_FAILURE_EXIT) return null;
    return stderrPreview.trim() || "docker run failed before the command started.";
  }
}

export type DockerCommandRunner = CommandRunner;

export const DockerCommandRunner = {
  async create(options: DockerRunnerOptions, dependencies: DockerRunnerDependencies = {}): Promise<CommandRunner> {
    const limits = await resolveRunnerLimits(options);
    const readOnlyMounts: { hostPath: string; containerPath: string }[] = [];
    for (const mount of options.readOnlyMounts ?? []) {
      const hostPath = await realpath(resolve(mount.hostPath));
      if (isInside(limits.workspacePath, hostPath)) {
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
    const launcher = new DockerLauncher(
      {
        workspacePath: limits.workspacePath,
        image,
        cpus: positiveNumber(options.cpus ?? DEFAULT_OPTIONS.cpus, "cpus"),
        memory: options.memory ?? DEFAULT_OPTIONS.memory,
        pidsLimit: positiveInteger(options.pidsLimit ?? DEFAULT_OPTIONS.pidsLimit, "pidsLimit"),
        network: options.network ?? "bridge",
        readOnlyMounts,
        uid: dependencies.uid ?? process.getuid?.() ?? 1_000,
        gid: dependencies.gid ?? process.getgid?.() ?? 1_000,
      },
      backend,
    );
    return new CommandRunner(limits, launcher, { HOME: CONTAINER_HOME, TMPDIR: "/tmp" }, dependencies);
  },
};
