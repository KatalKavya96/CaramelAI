import type { CommandResult } from "../execution";
import type { ModelAction, ModelDecision } from "../model";
import type { TaskMemory } from "../memory";
import type { FailureRecord } from "../recovery";
import { createEvidence, type VerificationEvidence } from "../verification";
import type { IsolatedWorkspace } from "../workspace";
import type { ToolObservation } from "./action-dispatcher";
import { currentState } from "./action-dispatcher";
import type { AgentEventWriter } from "./events";
import { DIRECT_IMPLEMENTATION_GUIDANCE_STEP, isExplorationAction, MAX_UNCHANGED_EXPLORATION_STEPS } from "./policy";
import type { ProgressTracker } from "./progress";
import type { AgentStatus } from "./types";

export interface ToolObservationContext {
  action: Exclude<ModelAction, { type: "finish" }>;
  intent?: string | undefined;
  observation: ToolObservation;
  workspace: IsolatedWorkspace;
  memory: TaskMemory;
  progress: ProgressTracker;
  events: AgentEventWriter;
  failures: FailureRecord[];
  verificationEvidence: VerificationEvidence[];
  maxStagnationInterventions: number;
  maxRepairAttempts: number;
}

export interface ObservationProcessResult {
  verifiedPatchSha: string | null;
  diffReviewedPatchSha: string | null;
  unchangedExplorationSteps: number;
  stagnationInterventions: number;
  repairAttempts: number;
  commandsRunIncrement: number;
  checkpointsCreatedIncrement: number;
  checkpointsRestoredIncrement: number;
  verificationCommandsIncrement: number;
  lastVerification: CommandResult | null;
  shouldTerminate: boolean;
  status?: AgentStatus;
  terminationReason?: string;
}

export async function processToolObservation(
  ctx: ToolObservationContext,
  current: {
    verifiedPatchSha: string | null;
    diffReviewedPatchSha: string | null;
    unchangedExplorationSteps: number;
    stagnationInterventions: number;
    repairAttempts: number;
    lastVerification: CommandResult | null;
  },
): Promise<ObservationProcessResult> {
  const { action, intent, observation, workspace, memory, progress, events, failures, verificationEvidence } = ctx;
  let verifiedPatchSha = current.verifiedPatchSha;
  let diffReviewedPatchSha = current.diffReviewedPatchSha;
  let unchangedExplorationSteps = current.unchangedExplorationSteps;
  let stagnationInterventions = current.stagnationInterventions;
  let repairAttempts = current.repairAttempts;
  let commandsRunIncrement = 0;
  let checkpointsCreatedIncrement = 0;
  let checkpointsRestoredIncrement = 0;
  let verificationCommandsIncrement = 0;
  let lastVerification = current.lastVerification;

  if (observation.workspaceChanged) {
    verifiedPatchSha = null;
    diffReviewedPatchSha = null;
    unchangedExplorationSteps = 0;
  } else if (isExplorationAction(action)) {
    unchangedExplorationSteps += 1;
    if (unchangedExplorationSteps === DIRECT_IMPLEMENTATION_GUIDANCE_STEP) {
      memory.recordGuidance(
        "Planning is complete. State the issue requirement addressed in intent, inspect at most one missing exact range, and then edit the relevant implementation or focused test.",
      );
    } else if (unchangedExplorationSteps === MAX_UNCHANGED_EXPLORATION_STEPS) {
      memory.recordGuidance(
        "The focused inspection phase is complete. Edit now using a unified diff patch, replace_text with a non-empty exact unique snippet, or replace_file with complete content. Tie the edit to the GitHub issue description; finish only if the task cannot be completed.",
      );
    }
  }

  if (action.type === "run_command") commandsRunIncrement += 1;
  if (action.type === "inspect_diff") {
    diffReviewedPatchSha = (await currentState(workspace)).patchSha256;
  }
  if (action.type === "create_checkpoint" && observation.failure === undefined) {
    checkpointsCreatedIncrement += 1;
  }
  if (action.type === "restore_checkpoint" && observation.failure === undefined) {
    checkpointsRestoredIncrement += 1;
  }

  if (observation.verification !== undefined) {
    verificationCommandsIncrement += 1;
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
    action: action.type,
    workspaceChanged: observation.workspaceChanged,
    result: observation.result,
  });

  const repetition = progress.observe(
    action,
    observation.result,
    (await currentState(workspace)).patchSha256,
  );
  if (repetition >= 2) {
    stagnationInterventions += 1;
    memory.recordGuidance(
      "The same action produced the same outcome on unchanged code. Choose a different investigation or hypothesis; do not repeat it without new evidence.",
    );
    if (stagnationInterventions >= ctx.maxStagnationInterventions) {
      memory.recordObservation(action, observation.result);
      return {
        verifiedPatchSha,
        diffReviewedPatchSha,
        unchangedExplorationSteps,
        stagnationInterventions,
        repairAttempts,
        commandsRunIncrement,
        checkpointsCreatedIncrement,
        checkpointsRestoredIncrement,
        verificationCommandsIncrement,
        lastVerification,
        shouldTerminate: true,
        status: "partial",
        terminationReason: "Stagnation limit reached after repeated unchanged actions.",
      };
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
      hypothesis: intent ?? null,
      action: action.type,
      detail: observation.failure.detail,
      codeFingerprint: state.patchSha256,
      countsAgainstRepairLimit,
    };
    failures.push(failure);
    memory.recordFailure(failure);
    if (repairAttempts >= ctx.maxRepairAttempts) {
      return {
        verifiedPatchSha,
        diffReviewedPatchSha,
        unchangedExplorationSteps,
        stagnationInterventions,
        repairAttempts,
        commandsRunIncrement,
        checkpointsCreatedIncrement,
        checkpointsRestoredIncrement,
        verificationCommandsIncrement,
        lastVerification,
        shouldTerminate: true,
        status: "partial",
        terminationReason: `Repair limit reached after ${repairAttempts} code-related failures.`,
      };
    }
  }

  memory.recordObservation(action, observation.result);

  return {
    verifiedPatchSha,
    diffReviewedPatchSha,
    unchangedExplorationSteps,
    stagnationInterventions,
    repairAttempts,
    commandsRunIncrement,
    checkpointsCreatedIncrement,
    checkpointsRestoredIncrement,
    verificationCommandsIncrement,
    lastVerification,
    shouldTerminate: false,
  };
}
