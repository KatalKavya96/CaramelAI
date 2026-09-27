import type { ModelAction, ModelAdapter, ModelError } from "../model";
import type { AgentEvent, AgentStatus, CommandExecutor } from "./types";

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

export interface ValidatedRunBudgets {
  maxRepairAttempts: number;
  verificationReserveSteps: number;
  maxStagnationInterventions: number;
}

export const DIRECT_IMPLEMENTATION_GUIDANCE_STEP = 3;
export const MAX_UNCHANGED_EXPLORATION_STEPS = 4;
export const MAX_UNCHANGED_SHELL_FILE_READS = 2;

export function validateRunOptions(options: AutonomousRunOptions): ValidatedRunBudgets {
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
  if (
    !Number.isInteger(verificationReserveSteps) ||
    verificationReserveSteps < 0 ||
    verificationReserveSteps >= options.maxSteps
  ) {
    throw new Error("verificationReserveSteps must be a non-negative integer smaller than maxSteps.");
  }
  const maxStagnationInterventions = options.maxStagnationInterventions ?? 2;
  if (!Number.isInteger(maxStagnationInterventions) || maxStagnationInterventions <= 0) {
    throw new Error("maxStagnationInterventions must be a positive integer.");
  }
  return { maxRepairAttempts, verificationReserveSteps, maxStagnationInterventions };
}

export function isExplorationAction(action: Exclude<ModelAction, { type: "finish" }>): boolean {
  return (
    action.type === "list_files" ||
    action.type === "search" ||
    action.type === "read_file" ||
    (action.type === "run_command" && action.purpose !== "verification")
  );
}

export function looksLikeShellFileRead(action: Exclude<ModelAction, { type: "finish" }>): boolean {
  if (action.type !== "run_command" || action.purpose === "verification") return false;
  return (
    /\b(cat|sed|awk|nl|head|tail|less|more)\b/.test(action.command) &&
    /\.(jsx?|tsx?|py|md|json|css|scss|html|yml|yaml|toml|txt)\b/.test(action.command)
  );
}

export function explorationRejection(
  action: Exclude<ModelAction, { type: "finish" }>,
  unchangedExplorationSteps: number,
): string | null {
  if (unchangedExplorationSteps >= MAX_UNCHANGED_EXPLORATION_STEPS && isExplorationAction(action)) {
    return "Action rejected because the unchanged-code exploration limit was reached. The next action must edit or conclude: apply_patch with a unified diff, replace_text with a non-empty exact unique snippet, replace_file with complete file content, inspect_diff, or finish.";
  }
  if (unchangedExplorationSteps >= MAX_UNCHANGED_SHELL_FILE_READS && looksLikeShellFileRead(action)) {
    return "Action rejected because shell file-printing is wasting the edit budget after prior inspection. Do not repeat cat/sed/nl/head/tail. Use read_file only for a small missing range; otherwise apply_patch, replace_text with a non-empty exact unique snippet, or replace_file now.";
  }
  return null;
}

export function statusForModelError(error: ModelError): AgentStatus {
  if (error.kind === "authentication") return "blocked";
  if (error.kind === "budget_exhausted") return "budget_exhausted";
  return "failed";
}
