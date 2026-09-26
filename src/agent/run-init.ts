import { mkdir } from "node:fs/promises";
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

  const repository = await RepositoryTools.create(workspace.workspacePath);
  const commandExecutor = await (
    dependencies.createCommandExecutor ??
    (async (workspacePath: string, logsPath: string) =>
      await DockerCommandRunner.create({ workspacePath, logsPath }))
  )(workspace.workspacePath, checksPath);

  const metadata = await repository.metadata();
  const discoveredChecks = metadata.ok ? discoverChecks(metadata.value) : [];
  const repositoryMap = options.repositoryMapEnabled === true
    ? await buildRepositoryMap({ repository, task: options.task })
    : null;

  const memory = new TaskMemory(SYSTEM_PROMPT, options.task, { metadata, discoveredChecks, repositoryMap }, {
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
  });

  return {
    runId,
    workspace,
    events,
    repository,
    commandExecutor,
    discoveredChecks,
    memory,
    readCache: new RepositoryReadCache(),
    progress: new ProgressTracker(),
    usage: emptyUsageSummary(),
    checkpoints: new Map<string, WorkspaceCheckpoint>(),
    failures: [],
    verificationEvidence: [],
  };
}
