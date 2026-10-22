import type { CommandNetwork, CommandRunner } from "./command-runner";
import { DockerCommandRunner } from "./docker-runner";
import { NATIVE_SANDBOX_HELP, NativeCommandRunner, detectNativeSandbox } from "./native-sandbox";

/**
 * Where target-repository commands run. "native" is the OS sandbox (Seatbelt or bubblewrap);
 * "docker" is a locked-down container; "auto" prefers native and falls back to Docker.
 */
export type SandboxChoice = "auto" | "native" | "docker";

export const SANDBOX_CHOICES: readonly SandboxChoice[] = ["auto", "native", "docker"];

export interface SandboxRunnerOptions {
  workspacePath: string;
  logsPath: string;
  network?: CommandNetwork;
  /** Host paths a native sandbox must hide, e.g. the server's data folder. Docker never mounts them. */
  denyRead?: readonly string[];
}

export async function createSandboxedRunner(choice: SandboxChoice, options: SandboxRunnerOptions): Promise<CommandRunner> {
  const native = () =>
    NativeCommandRunner.create({
      workspacePath: options.workspacePath,
      logsPath: options.logsPath,
      ...(options.network === undefined ? {} : { network: options.network }),
      ...(options.denyRead === undefined ? {} : { denyRead: options.denyRead }),
    });
  const docker = () =>
    DockerCommandRunner.create({
      workspacePath: options.workspacePath,
      logsPath: options.logsPath,
      ...(options.network === undefined ? {} : { network: options.network }),
    });
  if (choice === "native") return await native();
  if (choice === "docker") return await docker();
  if ((await detectNativeSandbox()) !== null) return await native();
  try {
    return await docker();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No sandbox is available for repository commands. ${NATIVE_SANDBOX_HELP[process.platform] ?? ""} Docker: ${detail}`.replace(/\s+/g, " ").trim(),
    );
  }
}
