import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DockerCommandRunner } from "../execution";
import { RepositoryReadCache, TaskMemory } from "../memory";
import { SYSTEM_PROMPT } from "../prompts";
import type { FailureRecord } from "../recovery";
import { buildRepositoryMap, RepositoryTools } from "../tools";
import { discoverChecks, type DiscoveredCheck, type VerificationEvidence } from "../verification";
import { IsolatedWorkspace, type WorkspaceCheckpoint } from "../workspace";
import { AgentEventWriter } from "./events";
import { ProgressTracker } from "./progress";
import type { AutonomousRunDependencies, AutonomousRunOptions } from "./policy";
import { emptyUsageSummary, type CommandExecutor, type UsageSummary } from "./types";

export interface InitializedRunContext {
  runId: string;
  workspace: IsolatedWorkspace;
  events: AgentEventWriter;
  repository: RepositoryTools;
  commandExecutor: CommandExecutor;
  discoveredChecks: DiscoveredCheck[];
  /** The only checks whose passing evidence can satisfy the completion gate. */
  trustedChecks: DiscoveredCheck[];
  memory: TaskMemory;
  readCache: RepositoryReadCache;
  progress: ProgressTracker;
  usage: UsageSummary;
  checkpoints: Map<string, WorkspaceCheckpoint>;
  failures: FailureRecord[];
  verificationEvidence: VerificationEvidence[];
}

export async function initializeRunContext(
  options: AutonomousRunOptions,
  dependencies: AutonomousRunDependencies,
  runId: string,
): Promise<InitializedRunContext> {
  const initialized = await IsolatedWorkspace.create({
    sourcePath: options.repoPath,
    runRoot: options.outputPath,
  });
  if (!initialized.ok) {
    throw new Error(`Workspace initialization failed: ${initialized.error.message}`);
  }
  const workspace = initialized.value;
  const checksPath = resolve(workspace.runRoot, "checks");
  await mkdir(checksPath, { recursive: true });

  const eventOptions: Parameters<typeof AgentEventWriter.create>[0] = {
    path: resolve(workspace.runRoot, "events.jsonl"),
    secrets: options.apiKey === undefined ? [] : [options.apiKey],
  };
  if (dependencies.onEvent !== undefined) eventOptions.onEvent = dependencies.onEvent;
  const events = await AgentEventWriter.create(eventOptions);

  const repository = await RepositoryTools.create(workspace.workspacePath, {}, {
    gitDir: workspace.gitDir,
    baseRevision: workspace.baselineRevision,
  });
  const commandExecutor = await (
    dependencies.createCommandExecutor ??
    (async (workspacePath: string, logsPath: string) =>
      await DockerCommandRunner.create({
        workspacePath,
        logsPath,
        ...(options.commandNetwork === undefined ? {} : { network: options.commandNetwork }),
      }))
  )(workspace.workspacePath, checksPath);

  const metadata = await repository.metadata();
  const discoveredChecks = metadata.ok
    ? discoverChecks(metadata.value, { packageJson: await readPackageJson(workspace.workspacePath) })
    : [];
  const trustedChecks: DiscoveredCheck[] = options.verificationCommands === undefined
    ? discoveredChecks
    : options.verificationCommands.map((command) => ({ command, source: "run configuration", category: "test" }));
  const repositoryMap = options.repositoryMapEnabled === true
    ? await buildRepositoryMap({ repository, task: options.task })
    : null;

  const verificationGate = {
    trustedCommands: trustedChecks.map((check) => check.command),
    rule: trustedChecks.length === 0
      ? "No trusted verification command is configured, so this run cannot finish as verified. Still run the most relevant tests and report the result."
      : "Only these exact commands, run from the workspace root with purpose verification, can verify the final state. Editing the file that defines a command (such as package.json scripts) makes it untrusted.",
  };
  const memory = new TaskMemory(SYSTEM_PROMPT, options.task, { metadata, discoveredChecks, verificationGate, repositoryMap }, {
    ...(options.maxContextChars === undefined ? {} : { maxContextChars: options.maxContextChars }),
  });

  await events.write("run_started", {
    runId,
    task: options.task,
    sourceRepo: workspace.sourcePath,
    workspacePath: workspace.workspacePath,
    budgets: {
      maxSteps: options.maxSteps,
      maxMinutes: options.maxMinutes,
      maxModelCalls: options.maxModelCalls,
    },
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
  });

  return {
    runId,
    workspace,
    events,
    repository,
    commandExecutor,
    discoveredChecks,
    trustedChecks,
    memory,
    readCache: new RepositoryReadCache(),
    progress: new ProgressTracker(),
    usage: emptyUsageSummary(),
    checkpoints: new Map<string, WorkspaceCheckpoint>(),
    failures: [],
    verificationEvidence: [],
  };
}

async function readPackageJson(workspacePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(workspacePath, "package.json"), "utf8"));
  } catch {
    // Missing or malformed manifests simply produce no package-script checks.
    return undefined;
  }
}
