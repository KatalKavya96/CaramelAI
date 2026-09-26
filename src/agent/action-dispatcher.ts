import type { CommandResult } from "../execution";
import type { ModelAction } from "../model";
import type { RepositoryReadCache, TaskMemory } from "../memory";
import type { RepositoryTools } from "../tools";
import { classifyCommandFailure, commandFailureDetail, type FailureKind } from "../recovery";
import type { IsolatedWorkspace, WorkspaceCheckpoint, WorkspaceState } from "../workspace";
import type { CommandExecutor } from "./types";

export interface ToolObservation {
  result: unknown;
  verification?: CommandResult;
  failure?: { kind: FailureKind; detail: string };
  workspaceChanged: boolean;
}

export interface DispatchActionOptions {
  action: Exclude<ModelAction, { type: "finish" }>;
  repository: RepositoryTools;
  workspace: IsolatedWorkspace;
  commandExecutor: CommandExecutor;
  checkpoints: Map<string, WorkspaceCheckpoint>;
  readCache: RepositoryReadCache;
  memory: TaskMemory;
  remainingTimeMs: number;
}

export async function currentState(workspace: IsolatedWorkspace): Promise<WorkspaceState> {
  const state = await workspace.inspectChanges();
  if (!state.ok) throw new Error(state.error.message);
  return state.value;
}

async function executeFileSystemAction(
  action: Extract<ModelAction, { type: "list_files" | "search" | "read_file" | "inspect_diff" }>,
  repository: RepositoryTools,
  readCache: RepositoryReadCache,
  memory: TaskMemory,
  patchSha256: string,
): Promise<unknown> {
  switch (action.type) {
    case "list_files":
      return await repository.listFiles({
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(action.maxDepth === undefined ? {} : { maxDepth: action.maxDepth }),
      });
    case "search":
      return await repository.search({
        query: action.query,
        ...(action.path === undefined ? {} : { path: action.path }),
        ...(action.maxResults === undefined ? {} : { maxResults: action.maxResults }),
      });
    case "read_file": {
      const cached = readCache.get(action.path, action.startLine, action.endLine, patchSha256);
      if (cached !== undefined) {
        memory.recordReadCache(true);
        return cached;
      }
      memory.recordReadCache(false);
      const readResult = await repository.readFile({
        path: action.path,
        ...(action.startLine === undefined ? {} : { startLine: action.startLine }),
        ...(action.endLine === undefined ? {} : { endLine: action.endLine }),
      });
      readCache.set(action.path, action.startLine, action.endLine, patchSha256, readResult);
      return readResult;
    }
    case "inspect_diff":
      return await repository.inspectDiff();
  }
}

async function executePatchAction(
  action: Extract<ModelAction, { type: "apply_patch" | "replace_text" | "replace_file" }>,
  workspace: IsolatedWorkspace,
): Promise<{ result: unknown; failure?: ToolObservation["failure"] }> {
  switch (action.type) {
    case "apply_patch": {
      const app = await workspace.applyPatch(action.patch);
      return { result: app, ...(app.ok ? {} : { failure: { kind: "patch", detail: app.error.message } }) };
    }
    case "replace_text": {
      const rep = await workspace.replaceText(action.path, action.search, action.replacement);
      return { result: rep, ...(rep.ok ? {} : { failure: { kind: "patch", detail: rep.error.message } }) };
    }
    case "replace_file": {
      const rep = await workspace.replaceFile(action.path, action.content);
      return { result: rep, ...(rep.ok ? {} : { failure: { kind: "patch", detail: rep.error.message } }) };
    }
  }
}

async function executeCheckpointAction(
  action: Extract<ModelAction, { type: "create_checkpoint" | "restore_checkpoint" }>,
  workspace: IsolatedWorkspace,
  checkpoints: Map<string, WorkspaceCheckpoint>,
): Promise<{ result: unknown; failure?: ToolObservation["failure"] }> {
  if (action.type === "create_checkpoint") {
    const checkpoint = await workspace.createCheckpoint(action.label);
    if (checkpoint.ok) {
      checkpoints.set(checkpoint.value.id, checkpoint.value);
      return {
        result: {
          ok: true,
          value: {
            id: checkpoint.value.id,
            label: checkpoint.value.label,
            changedFiles: checkpoint.value.changedFiles,
          },
        },
      };
    }
    return { result: checkpoint, failure: { kind: "tool", detail: checkpoint.error.message } };
  }

  const checkpoint = action.checkpointId === "latest"
    ? [...checkpoints.values()].at(-1)
    : checkpoints.get(action.checkpointId);
  if (checkpoint === undefined) {
    return {
      result: { ok: false, error: { code: "CHECKPOINT_INVALID", message: "Unknown checkpoint ID." } },
      failure: { kind: "tool", detail: "Unknown checkpoint ID." },
    };
  }
  const restoration = await workspace.restoreCheckpoint(checkpoint);
  return {
    result: restoration,
    ...(restoration.ok ? {} : { failure: { kind: "tool", detail: restoration.error.message } }),
  };
}

async function executeCommandAction(
  action: Extract<ModelAction, { type: "run_command" }>,
  commandExecutor: CommandExecutor,
  remainingTimeMs: number,
): Promise<{ result: CommandResult; verification?: CommandResult; failure?: ToolObservation["failure"] }> {
  const requestedTimeout = action.timeoutMs ?? remainingTimeMs;
  const commandResult = await commandExecutor.run({
    command: action.command,
    purpose: action.purpose ?? "agent",
    ...(action.cwd === undefined ? {} : { cwd: action.cwd }),
    timeoutMs: Math.max(1, Math.min(requestedTimeout, remainingTimeMs)),
  });
  const verification = commandResult.purpose === "verification" ? commandResult : undefined;
  const kind = classifyCommandFailure(commandResult);
  const failure = kind !== null ? { kind, detail: commandFailureDetail(commandResult) } : undefined;
  return {
    result: commandResult,
    ...(verification === undefined ? {} : { verification }),
    ...(failure === undefined ? {} : { failure }),
  };
}

export async function dispatchAction(options: DispatchActionOptions): Promise<ToolObservation> {
  const { action, repository, workspace, commandExecutor, checkpoints, readCache, memory, remainingTimeMs } = options;
  const before = await currentState(workspace);
  let outcome: { result: unknown; verification?: CommandResult; failure?: ToolObservation["failure"] };

  if (
    action.type === "list_files" ||
    action.type === "search" ||
    action.type === "read_file" ||
    action.type === "inspect_diff"
  ) {
    const result = await executeFileSystemAction(action, repository, readCache, memory, before.patchSha256);
    outcome = { result };
  } else if (
    action.type === "apply_patch" ||
    action.type === "replace_text" ||
    action.type === "replace_file"
  ) {
    outcome = await executePatchAction(action, workspace);
  } else if (
    action.type === "create_checkpoint" ||
    action.type === "restore_checkpoint"
  ) {
    outcome = await executeCheckpointAction(action, workspace, checkpoints);
  } else {
    outcome = await executeCommandAction(action, commandExecutor, remainingTimeMs);
  }

  const after = await currentState(workspace);
  return {
    result: outcome.result,
    workspaceChanged: before.patchSha256 !== after.patchSha256,
    ...(outcome.verification === undefined ? {} : { verification: outcome.verification }),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}
