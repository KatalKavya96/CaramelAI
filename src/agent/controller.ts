import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DockerCommandRunner, type CommandResult } from "../execution";
import {
  ModelError,
  type ModelAction,
  type ModelAdapter,
} from "../model";
import { RepositoryReadCache, TaskMemory } from "../memory";
import { buildRepositoryMap, RepositoryTools } from "../tools";
import { createEvidence, discoverChecks, evidenceForFinalState, type VerificationEvidence } from "../verification";
import { classifyCommandFailure, commandFailureDetail, type FailureKind, type FailureRecord } from "../recovery";
import { IsolatedWorkspace, type WorkspaceCheckpoint, type WorkspaceState } from "../workspace";
import { AgentEventWriter } from "./events";
import { ProgressTracker } from "./progress";
import { renderEvidenceReport } from "./report";
import {
  emptyUsageSummary,
  recordUsage,
  type AgentEvent,
  type AgentRunResult,
  type AgentStatus,
  type CommandExecutor,
} from "./types";

export interface AutonomousRunOptions {
  repoPath: string;
  outputPath: string;
  task: string;
  maxSteps: number;
  maxMinutes: number;
  maxModelCalls: number;
  maxRepairAttempts?: number;
  maxContextChars?: number;
  verificationReserveSteps?: number;
  maxStagnationInterventions?: number;
  repositoryMapEnabled?: boolean;
  apiKey?: string;
}

export interface AutonomousRunDependencies {
  model: ModelAdapter;
  createCommandExecutor?: (
    workspacePath: string,
    logsPath: string,
  ) => Promise<CommandExecutor>;
  onEvent?: (event: AgentEvent) => void;
  now?: () => number;
  runId?: string;
}

interface ToolObservation {
  result: unknown;
  verification?: CommandResult;
  failure?: { kind: FailureKind; detail: string };
  workspaceChanged: boolean;
}

export const SYSTEM_PROMPT = `You are an autonomous coding agent running inside a strict coding harness. Choose exactly one structured action per turn.

Output contract:
- Return only one valid JSON object shaped as {"intent":"short description","action":{"type":"...",...}}.
- Do not wrap JSON in Markdown. Do not include prose before or after JSON. Do not emit partial JSON.
- Every action must include all required fields. For replace_text, path/search/replacement are required and search must be a non-empty exact snippet.

Execution strategy:
- Inspect just enough to identify the target file and exact edit location, then edit. Do not keep exploring once the relevant file and component are known.
- Prefer list_files, search, and read_file for repository inspection. Avoid shell file-printing commands such as cat, sed, awk, nl, head, or tail for source files; the harness may reject them after bounded inspection.
- Use run_command only for setup, agent commands that cannot be represented by repository tools, or verification. Commands run in an isolated Docker container whose workspace root is /workspace; never use host artifact paths or host workspace paths in commands.

Editing strategy:
- apply_patch must be a real unified git diff, not a *** Begin Patch block.
- If apply_patch fails, recover immediately with replace_text when you know an exact unique snippet.
- Use replace_text for small focused edits. The search field must exactly match existing file text and must be unique. Never send an empty search string.
- Use replace_file only when you have the complete intended content for that file. Do not replace a whole file from a partial excerpt.
- Create a checkpoint before a risky multi-file approach and restore it when abandoning that approach.

Progress and recovery:
- If a model/provider error, invalid JSON warning, rejected shell read, rejected empty replace_text, or stale/corrupt patch is reported, adjust the next action instead of repeating the same failed behavior.
- If the exploration budget is exhausted, the next action must be apply_patch, replace_text, replace_file, inspect_diff, or finish.
- Do not ask the user questions during the run; act from the issue text and repository evidence.

Verification and finish:
- After the final edit, inspect_diff, then run the most relevant available verification command.
- Label commands as setup, agent, or verification.
- Never claim a check passed unless its observed tool result says it passed.
- Finish only after the final diff has been inspected and verification has run, or explain clearly why completion is partial.
- Do not remove assertions, disable tests, or modify evaluator inputs to manufacture success.`;

const MAX_UNCHANGED_EXPLORATION_STEPS = 6;
const MAX_UNCHANGED_SHELL_FILE_READS = 2;

function isExplorationAction(action: Exclude<ModelAction, { type: "finish" }>): boolean {
  return action.type === "list_files" ||
    action.type === "search" ||
    action.type === "read_file" ||
    (action.type === "run_command" && action.purpose !== "verification");
}

function looksLikeShellFileRead(action: Exclude<ModelAction, { type: "finish" }>): boolean {
  if (action.type !== "run_command" || action.purpose === "verification") return false;
  return /\b(cat|sed|awk|nl|head|tail|less|more)\b/.test(action.command) &&
    /\.(jsx?|tsx?|py|md|json|css|scss|html|yml|yaml|toml|txt)\b/.test(action.command);
}

function explorationRejection(action: Exclude<ModelAction, { type: "finish" }>, unchangedExplorationSteps: number): string | null {
  if (unchangedExplorationSteps >= MAX_UNCHANGED_EXPLORATION_STEPS && isExplorationAction(action)) {
    return "Action rejected because the unchanged-code exploration limit was reached. The next action must edit or conclude: apply_patch with a unified diff, replace_text with a non-empty exact unique snippet, replace_file with complete file content, inspect_diff, or finish.";
  }
  if (unchangedExplorationSteps >= MAX_UNCHANGED_SHELL_FILE_READS && looksLikeShellFileRead(action)) {
    return "Action rejected because shell file-printing is wasting the edit budget after prior inspection. Do not repeat cat/sed/nl/head/tail. Use read_file only for a small missing range; otherwise apply_patch, replace_text with a non-empty exact unique snippet, or replace_file now.";
  }
  return null;
}

async function currentState(workspace: IsolatedWorkspace): Promise<WorkspaceState> {
  const state = await workspace.inspectChanges();
  if (!state.ok) throw new Error(state.error.message);
  return state.value;
}

async function dispatchAction(options: {
  action: Exclude<ModelAction, { type: "finish" }>;
  repository: RepositoryTools;
  workspace: IsolatedWorkspace;
  commandExecutor: CommandExecutor;
  checkpoints: Map<string, WorkspaceCheckpoint>;
  readCache: RepositoryReadCache;
  memory: TaskMemory;
  remainingTimeMs: number;
}): Promise<ToolObservation> {
  const { action, repository, workspace, commandExecutor } = options;
  const before = await currentState(workspace);
  let result: unknown;
  let verification: CommandResult | undefined;
  let failure: ToolObservation["failure"];

  switch (action.type) {
    case "list_files":
      result = await repository.listFiles({
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(action.maxDepth === undefined ? {} : { maxDepth: action.maxDepth }),
      });
      break;
    case "search":
      result = await repository.search({
        query: action.query,
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(action.maxResults === undefined ? {} : { maxResults: action.maxResults }),
      });
      break;
    case "read_file":
      result = options.readCache.get(action.path, action.startLine, action.endLine, before.patchSha256);
      if (result === undefined) {
        options.memory.recordReadCache(false);
        const readResult = await repository.readFile({
          path: action.path,
          ...(action.startLine === undefined ? {} : { startLine: action.startLine }),
          ...(action.endLine === undefined ? {} : { endLine: action.endLine }),
        });
        result = readResult;
        options.readCache.set(action.path, action.startLine, action.endLine, before.patchSha256, readResult);
      } else {
        options.memory.recordReadCache(true);
      }
      break;
    case "inspect_diff":
      result = await repository.inspectDiff();
      break;
    case "apply_patch": {
      const application = await workspace.applyPatch(action.patch);
      result = application;
      if (!application.ok) failure = { kind: "patch", detail: application.error.message };
      break;
    }
    case "replace_text": {
      const replacement = await workspace.replaceText(action.path, action.search, action.replacement);
      result = replacement;
      if (!replacement.ok) failure = { kind: "patch", detail: replacement.error.message };
      break;
    }
    case "replace_file": {
      const replacement = await workspace.replaceFile(action.path, action.content);
      result = replacement;
      if (!replacement.ok) failure = { kind: "patch", detail: replacement.error.message };
      break;
    }
    case "create_checkpoint": {
      const checkpoint = await workspace.createCheckpoint(action.label);
      if (checkpoint.ok) {
        options.checkpoints.set(checkpoint.value.id, checkpoint.value);
        result = {
          ok: true,
          value: {
            id: checkpoint.value.id,
            label: checkpoint.value.label,
            changedFiles: checkpoint.value.changedFiles,
          },
        };
      } else {
        result = checkpoint;
        failure = { kind: "tool", detail: checkpoint.error.message };
      }
      break;
    }
    case "restore_checkpoint": {
      const checkpoint = action.checkpointId === "latest"
        ? [...options.checkpoints.values()].at(-1)
        : options.checkpoints.get(action.checkpointId);
      if (checkpoint === undefined) {
        result = { ok: false, error: { code: "CHECKPOINT_INVALID", message: "Unknown checkpoint ID." } };
        failure = { kind: "tool", detail: "Unknown checkpoint ID." };
      } else {
        const restoration = await workspace.restoreCheckpoint(checkpoint);
        result = restoration;
        if (!restoration.ok) failure = { kind: "tool", detail: restoration.error.message };
      }
      break;
    }
    case "run_command": {
      const requestedTimeout = action.timeoutMs ?? options.remainingTimeMs;
      const commandResult = await commandExecutor.run({
        command: action.command,
        purpose: action.purpose ?? "agent",
        ...(action.cwd === undefined ? {} : { cwd: action.cwd }),
        timeoutMs: Math.max(1, Math.min(requestedTimeout, options.remainingTimeMs)),
      });
      result = commandResult;
      if (commandResult.purpose === "verification") verification = commandResult;
      const kind = classifyCommandFailure(commandResult);
      if (kind !== null) failure = { kind, detail: commandFailureDetail(commandResult) };
      break;
    }
  }

  const after = await currentState(workspace);
  return {
    result,
    workspaceChanged: before.patchSha256 !== after.patchSha256,
    ...(verification === undefined ? {} : { verification }),
    ...(failure === undefined ? {} : { failure }),
  };
}

function statusForModelError(error: ModelError): AgentStatus {
  if (error.kind === "authentication") return "blocked";
  if (error.kind === "budget_exhausted") return "budget_exhausted";
  return "failed";
}

export async function runAutonomousTask(
  options: AutonomousRunOptions,
  dependencies: AutonomousRunDependencies,
): Promise<AgentRunResult> {
  if (!Number.isInteger(options.maxSteps) || options.maxSteps <= 0) {
    throw new Error("maxSteps must be a positive integer.");
  }
  if (!Number.isInteger(options.maxModelCalls) || options.maxModelCalls <= 0) {
    throw new Error("maxModelCalls must be a positive integer.");
  }
  if (!Number.isFinite(options.maxMinutes) || options.maxMinutes <= 0) {
    throw new Error("maxMinutes must be positive.");
  }
  const maxRepairAttempts = options.maxRepairAttempts ?? 4;
  if (!Number.isInteger(maxRepairAttempts) || maxRepairAttempts <= 0) {
    throw new Error("maxRepairAttempts must be a positive integer.");
  }
  const verificationReserveSteps =
    options.verificationReserveSteps ?? Math.min(3, Math.max(0, options.maxSteps - 1));
  if (!Number.isInteger(verificationReserveSteps) || verificationReserveSteps < 0 || verificationReserveSteps >= options.maxSteps) {
    throw new Error("verificationReserveSteps must be a non-negative integer smaller than maxSteps.");
  }
  const maxStagnationInterventions = options.maxStagnationInterventions ?? 2;
  if (!Number.isInteger(maxStagnationInterventions) || maxStagnationInterventions <= 0) {
    throw new Error("maxStagnationInterventions must be a positive integer.");
  }
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + options.maxMinutes * 60_000;
  const runId = dependencies.runId ?? crypto.randomUUID();
  const initialized = await IsolatedWorkspace.create({
    sourcePath: options.repoPath,
    runRoot: options.outputPath,
  });
  if (!initialized.ok) throw new Error(`Workspace initialization failed: ${initialized.error.message}`);
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
    (async (workspacePath, logsPath) =>
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
  const readCache = new RepositoryReadCache();
  const progress = new ProgressTracker();
  const usage = emptyUsageSummary();
  const checkpoints = new Map<string, WorkspaceCheckpoint>();
  const failures: FailureRecord[] = [];
  let repairAttempts = 0;
  let checkpointsCreated = 0;
  let checkpointsRestored = 0;
  let steps = 0;
  let modelCalls = 0;
  let commandsRun = 0;
  let stagnationInterventions = 0;
  let unchangedExplorationSteps = 0;
  let consecutiveInvalidResponses = 0;
  let verificationReserveActivations = 0;
  let reserveActive = false;
  let verificationCommands = 0;
  let lastVerification: CommandResult | null = null;
  let verifiedPatchSha: string | null = null;
  let diffReviewedPatchSha: string | null = null;
  const verificationEvidence: VerificationEvidence[] = [];
  let status: AgentStatus = "failed";
  let terminationReason = "Controller stopped unexpectedly.";
  let summary = "No model summary was produced.";

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

  while (true) {
    const remainingTimeMs = deadline - now();
    if (remainingTimeMs <= 0 || steps >= options.maxSteps || modelCalls >= options.maxModelCalls) {
      status = "budget_exhausted";
      terminationReason =
        remainingTimeMs <= 0
          ? "Wall-clock budget exhausted."
          : steps >= options.maxSteps
            ? "Step budget exhausted."
            : "Model-call budget exhausted.";
      break;
    }
    if (!reserveActive && verificationReserveSteps > 0) {
      const state = await currentState(workspace);
      if (
        state.changedFiles.length > 0 &&
        steps >= options.maxSteps - verificationReserveSteps - 1
      ) {
        reserveActive = true;
        verificationReserveActivations += 1;
        memory.recordGuidance("Verification reserve is active. Use only verification commands, inspect_diff, or finish. Resolve final evidence before any further exploration or edits.");
      }
    }

    let turn;
    try {
      modelCalls += 1;
      turn = await dependencies.model.complete(memory.request(), { remainingTimeMs });
      recordUsage(usage, turn.usage);
    } catch (error) {
      const modelError =
        error instanceof ModelError
          ? error
          : new ModelError(
              "transport",
              error instanceof Error ? error.message : String(error),
              false,
              1,
              { cause: error },
            );
      await events.write("model_error", {
        kind: modelError.kind,
        message: modelError.message,
        attempts: modelError.attempts,
      });
      const failure: FailureRecord = {
        sequence: failures.length + 1,
        kind: "model",
        hypothesis: null,
        action: "model_call",
        detail: `${modelError.kind}: ${modelError.message}`,
        codeFingerprint: (await currentState(workspace)).patchSha256,
        countsAgainstRepairLimit: false,
      };
      failures.push(failure);
      memory.recordFailure(failure);
      if (modelError.kind === "invalid_response" && modelCalls < options.maxModelCalls) {
        consecutiveInvalidResponses += 1;
        if (consecutiveInvalidResponses <= 3) {
          modelCalls -= 1; // Refund the call — invalid JSON shouldn't exhaust the budget
          memory.recordInvalidResponse(modelError.message);
          continue;
        }
      }
      if (modelError.retryable && modelCalls < options.maxModelCalls) {
        memory.recordGuidance(`The prior provider call failed transiently: ${modelError.message}. Continue from the latest observed state with one valid structured action.`);
        continue;
      }
      status = statusForModelError(modelError);
      terminationReason = `Model error (${modelError.kind}): ${modelError.message}`;
      break;
    }

    consecutiveInvalidResponses = 0; // Reset on successful parse
    const { decision } = turn;
    await events.write("model_decision", decision);
    memory.recordDecision(decision);

    if (decision.action.type === "finish") {
      summary = decision.action.summary;
      const state = await currentState(workspace);
      const verified =
        state.changedFiles.length > 0 &&
        verifiedPatchSha !== null &&
        verifiedPatchSha === state.patchSha256 &&
        diffReviewedPatchSha === state.patchSha256;
      status = verified ? "verified" : "partial";
      terminationReason = verified
        ? "Model requested finish with successful verification for the final code state."
        : state.changedFiles.length === 0
          ? "Model requested finish without producing code changes."
          : diffReviewedPatchSha !== state.patchSha256
            ? "Model requested finish without reviewing the final diff."
            : "Model requested finish without successful verification for the final changed state.";
      break;
    }

    steps += 1;
    try {
      const explorationError = explorationRejection(decision.action, unchangedExplorationSteps);
      if (explorationError !== null) {
        steps -= 1;
        stagnationInterventions += 1;
        const rejection = {
          ok: false,
          error: explorationError,
        };
        await events.write("tool_result", {
          action: decision.action.type,
          workspaceChanged: false,
          result: rejection,
        });
        memory.recordObservation(decision.action, rejection);
        memory.recordGuidance("The inspection budget for unchanged code is exhausted. The next action must be apply_patch, replace_text, replace_file, inspect_diff, or finish. Prefer replace_text for exact unique snippets; never send an empty search string; use replace_file only with complete corrected file text.");
        if (stagnationInterventions >= maxStagnationInterventions) {
          status = "partial";
          terminationReason = "Stagnation limit reached after repeated exploration without code changes.";
          break;
        }
        continue;
      }
      const allowedDuringReserve =
        decision.action.type === "inspect_diff" ||
        (decision.action.type === "run_command" && decision.action.purpose === "verification");
      if (reserveActive && !allowedDuringReserve) {
        steps -= 1;
        const rejection = { ok: false, error: "Action rejected because the final verification reserve is active." };
        await events.write("tool_result", { action: decision.action.type, workspaceChanged: false, result: rejection });
        memory.recordObservation(decision.action, rejection);
        continue;
      }
      const observation = await dispatchAction({
        action: decision.action,
        repository,
        workspace,
        commandExecutor,
        checkpoints,
        readCache,
        memory,
        remainingTimeMs: Math.max(1, deadline - now()),
      });
      if (observation.workspaceChanged) {
        verifiedPatchSha = null;
        diffReviewedPatchSha = null;
        unchangedExplorationSteps = 0;
      } else if (isExplorationAction(decision.action)) {
        unchangedExplorationSteps += 1;
        if (unchangedExplorationSteps === MAX_UNCHANGED_EXPLORATION_STEPS) {
          memory.recordGuidance("You have enough inspection evidence and the unchanged-code exploration budget is exhausted. Edit next using a unified diff patch, replace_text with a non-empty exact unique snippet, or replace_file with complete content; finish only if the task cannot be completed.");
        }
      }
      if (decision.action.type === "run_command") commandsRun += 1;
      if (decision.action.type === "inspect_diff") {
        diffReviewedPatchSha = (await currentState(workspace)).patchSha256;
      }
      if (decision.action.type === "create_checkpoint" && observation.failure === undefined) {
        checkpointsCreated += 1;
      }
      if (decision.action.type === "restore_checkpoint" && observation.failure === undefined) {
        checkpointsRestored += 1;
      }
      if (observation.verification !== undefined) {
        verificationCommands += 1;
        lastVerification = observation.verification;
        const state = await currentState(workspace);
        const evidence = createEvidence({
          result: observation.verification,
          codeFingerprint: state.patchSha256,
          baseline: state.changedFiles.length === 0,
        });
        verificationEvidence.push(evidence);
        memory.recordCheck(evidence);
        verifiedPatchSha = evidence.status === "passed" && !observation.workspaceChanged
          ? state.patchSha256
          : null;
      }
      await events.write("tool_result", {
        action: decision.action.type,
        workspaceChanged: observation.workspaceChanged,
        result: observation.result,
      });
      const repetition = progress.observe(
        decision.action,
        observation.result,
        (await currentState(workspace)).patchSha256,
      );
      if (repetition >= 2) {
        stagnationInterventions += 1;
        memory.recordGuidance("The same action produced the same outcome on unchanged code. Choose a different investigation or hypothesis; do not repeat it without new evidence.");
        if (stagnationInterventions >= maxStagnationInterventions) {
          status = "partial";
          terminationReason = "Stagnation limit reached after repeated unchanged actions.";
          memory.recordObservation(decision.action, observation.result);
          break;
        }
      }
      if (observation.failure !== undefined) {
        const state = await currentState(workspace);
        const countsAgainstRepairLimit =
          observation.failure.kind === "test" || observation.failure.kind === "patch";
        if (countsAgainstRepairLimit) repairAttempts += 1;
        const failure: FailureRecord = {
          sequence: failures.length + 1,
          kind: observation.failure.kind,
          hypothesis: decision.intent ?? null,
          action: decision.action.type,
          detail: observation.failure.detail,
          codeFingerprint: state.patchSha256,
          countsAgainstRepairLimit,
        };
        failures.push(failure);
        memory.recordFailure(failure);
        if (repairAttempts >= maxRepairAttempts) {
          status = "partial";
          terminationReason = `Repair limit reached after ${repairAttempts} code-related failures.`;
          break;
        }
      }
      memory.recordObservation(decision.action, observation.result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failure: FailureRecord = {
        sequence: failures.length + 1,
        kind: "tool",
        hypothesis: decision.intent ?? null,
        action: decision.action.type,
        detail,
        codeFingerprint: (await currentState(workspace)).patchSha256,
        countsAgainstRepairLimit: false,
      };
      failures.push(failure);
      memory.recordFailure(failure);
      await events.write("tool_result", {
        action: decision.action.type,
        workspaceChanged: false,
        error: detail,
      });
      memory.recordObservation(decision.action, { ok: false, error: detail });
    }
  }

  const exported = await workspace.exportPatch();
  if (!exported.ok) {
    status = "failed";
    terminationReason = `Patch export failed: ${exported.error.message}`;
  }
  const exportValue = exported.ok
    ? exported.value
    : { patchPath: resolve(workspace.runRoot, "patch.diff"), changedFiles: [] };
  const finalState = await currentState(workspace);
  const finalEvidence = evidenceForFinalState(verificationEvidence, finalState.patchSha256);
  const successfulFinalState =
    finalState.changedFiles.length > 0 &&
    finalEvidence.at(-1)?.status === "passed" &&
    diffReviewedPatchSha === finalState.patchSha256;
  const resultPath = resolve(workspace.runRoot, "result.json");
  const reportPath = resolve(workspace.runRoot, "report.md");
  const result: AgentRunResult = {
    runId,
    status,
    terminationReason,
    summary,
    task: options.task,
    sourceRepo: workspace.sourcePath,
    workspacePath: workspace.workspacePath,
    resultPath,
    eventsPath: events.path,
    patchPath: exportValue.patchPath,
    reportPath,
    changedFiles: exportValue.changedFiles,
    verification: {
      commandsRun: verificationCommands,
      successfulFinalState,
      diffReviewedForFinalState: diffReviewedPatchSha === finalState.patchSha256,
      discoveredChecks,
      evidence: verificationEvidence,
      lastResult: lastVerification,
    },
    recovery: {
      maxRepairAttempts,
      repairAttempts,
      failures,
      checkpointsCreated,
      checkpointsRestored,
    },
    memory: memory.snapshot(),
    metrics: {
      steps,
      modelCalls,
      commandsRun,
      stagnationInterventions,
      verificationReserveActivations,
      durationMs: Math.max(0, now() - startedAt),
    },
    usage,
  };
  await events.write("run_finished", {
    status: result.status,
    terminationReason: result.terminationReason,
    changedFiles: result.changedFiles,
    successfulFinalState,
  });
  await writeFile(reportPath, renderEvidenceReport(result, finalState.patchSha256));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function createAgentEventRenderer(
  write: (message: string) => void = console.log,
  options: { color?: boolean } = {},
): (event: AgentEvent) => void {
  const color = options.color ?? true;
  const paint = (code: number, text: string) => color ? `\u001b[${code}m${text}\u001b[0m` : text;
  const pretty = (value: unknown) => JSON.stringify(compactForTerminal(value), null, 2);
  const heading = (event: AgentEvent, marker: string, label: string) =>
    `[${String(event.sequence).padStart(3, "0")}] ${marker} ${label}`;
  return (event) => {
    if (event.type === "run_started") {
      write(`${paint(36, heading(event, "▶", "RUN STARTED"))}\n${pretty(event.payload)}`);
    }
    if (event.type === "model_decision") {
      const payload = event.payload as { action?: { type?: unknown }; intent?: unknown };
      write(`${paint(35, heading(event, "◆", `MODEL → ${String(payload.action?.type)}`))}\n${pretty(payload)}`);
    }
    if (event.type === "model_error") {
      write(`${paint(31, heading(event, "!", "MODEL ERROR"))}\n${pretty(event.payload)}`);
    }
    if (event.type === "tool_result") {
      const payload = event.payload as { action?: unknown; workspaceChanged?: unknown };
      const changed = payload.workspaceChanged === true ? "changed" : "unchanged";
      write(`${paint(36, heading(event, "●", `RESULT ← ${String(payload.action)} (${changed})`))}\n${pretty(payload)}`);
    }
    if (event.type === "run_finished") {
      const payload = event.payload as { status?: unknown };
      const code = payload.status === "verified" ? 32 : 33;
      write(`${paint(code, heading(event, "■", `RUN FINISHED: ${String(payload.status)}`))}\n${pretty(payload)}`);
    }
  };
}

function compactText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…[truncated ${value.length - maxChars} chars]`;
}

function compactForTerminal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactForTerminal);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (
    record.ok === true &&
    typeof record.value === "object" &&
    record.value !== null &&
    typeof (record.value as { content?: unknown }).content === "string"
  ) {
    const read = record.value as Record<string, unknown>;
    const content = read.content as string;
    return {
      ...record,
      value: {
        ...read,
        content: compactText(content, 900),
        contentChars: content.length,
      },
    };
  }
  if (
    typeof record.preview === "string" &&
    typeof record.capturedBytes === "number"
  ) {
    return {
      ...record,
      preview: compactText(record.preview, 900),
      previewChars: record.preview.length,
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, compactForTerminal(nested)]),
  );
}

export function renderAgentEvent(event: AgentEvent): void {
  createAgentEventRenderer()(event);
}

export function defaultRunId(outputPath: string): string {
  return basename(outputPath);
}
