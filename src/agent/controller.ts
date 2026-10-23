import type { CommandResult } from "../execution";
import type { ModelAdapter } from "../model";
import { SYSTEM_PROMPT } from "../prompts";
import type { FailureRecord } from "../recovery";
import { currentState, dispatchAction, UNAVAILABLE_FINGERPRINT } from "./action-dispatcher";
import { executeModelTurn } from "./model-turn";
import { processToolObservation } from "./observation-handler";
import {
  explorationRejection,
  validateRunOptions,
  type AutonomousRunDependencies,
  type AutonomousRunOptions,
} from "./policy";
import { initializeRunContext } from "./run-init";
import { evaluateFinishDecision, finalizeRun, MAX_FINISH_REJECTIONS, missingFinishRequirements } from "./run-finalizer";
import type {
  AgentEvent,
  AgentRunResult,
  AgentStatus,
  CommandExecutor,
} from "./types";

export { SYSTEM_PROMPT } from "../prompts";
export { createAgentEventRenderer, defaultRunId, renderAgentEvent } from "./event-renderer";
export type { AutonomousRunDependencies, AutonomousRunOptions } from "./policy";

export async function runAutonomousTask(
  options: AutonomousRunOptions,
  dependencies: AutonomousRunDependencies,
): Promise<AgentRunResult> {
  const budgets = validateRunOptions(options);
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + options.maxMinutes * 60_000;
  const runId = dependencies.runId ?? crypto.randomUUID();

  const ctx = await initializeRunContext(options, dependencies, runId);
  const { workspace, events, memory, repository, commandExecutor, checkpoints, readCache, progress, usage, failures, verificationEvidence } = ctx;

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
  let finishRejections = 0;
  let reserveActive = false;
  let verificationCommands = 0;
  let lastVerification: CommandResult | null = null;
  let verifiedPatchSha: string | null = null;
  let diffReviewedPatchSha: string | null = null;
  let status: AgentStatus = "failed";
  let terminationReason = "Controller stopped unexpectedly.";
  let summary = "No model summary was produced.";

  // Any unexpected error still ends in finalizeRun, so every run leaves result.json and report.md.
  try {
    // Workspace state is computed once per action and carried forward: only actions change it.
    let lastState = await currentState(workspace);
    while (true) {
      if (dependencies.signal?.aborted === true) {
        status = "cancelled";
        terminationReason = "Run cancelled by the user.";
        break;
      }
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

      if (!reserveActive && budgets.verificationReserveSteps > 0) {
        if (lastState.changedFiles.length > 0 && steps >= options.maxSteps - budgets.verificationReserveSteps - 1) {
          reserveActive = true;
          verificationReserveActivations += 1;
          memory.recordGuidance(
            "Verification reserve is active. Use only verification commands, inspect_diff, or finish. Resolve final evidence before any further exploration or edits.",
          );
        }
      }

      modelCalls += 1;
      const turnResult = await executeModelTurn(
        {
          model: dependencies.model,
          memory,
          codeFingerprint: lastState.fingerprint,
          events,
          usage,
          failures,
          maxModelCalls: options.maxModelCalls,
          remainingTimeMs,
          signal: dependencies.signal,
        },
        { modelCalls, consecutiveInvalidResponses },
      );

      if (turnResult.kind === "retry") {
        if (turnResult.refundCall) modelCalls -= 1;
        if (turnResult.incrementInvalidResponses) consecutiveInvalidResponses += 1;
        continue;
      }

      if (turnResult.kind === "terminate") {
        status = turnResult.status;
        terminationReason = turnResult.terminationReason;
        break;
      }

      consecutiveInvalidResponses = 0;
      const decision = turnResult.decision;

      if (decision.action.type === "finish") {
        summary = decision.action.summary;
        const finishOutcome = evaluateFinishDecision(
          lastState.changedFiles.length,
          lastState.fingerprint,
          verifiedPatchSha,
          diffReviewedPatchSha,
          ctx.trustedChecks.length > 0,
        );
        const missing = missingFinishRequirements({
          changedFiles: lastState.changedFiles.length,
          fingerprint: lastState.fingerprint,
          verifiedPatchSha,
          diffReviewedPatchSha,
          trustedCommands: ctx.trustedChecks.map((check) => check.command),
        });
        // A gate that only says "no" wastes the run; while there is budget, say what is missing.
        if (finishOutcome.status !== "verified" && missing.length > 0 && finishRejections < MAX_FINISH_REJECTIONS) {
          finishRejections += 1;
          const rejection = { ok: false, error: `Finish rejected: ${missing.join(" ")}` };
          await events.write("tool_result", { action: "finish", workspaceChanged: false, result: rejection });
          memory.recordObservation(decision.action, rejection);
          continue;
        }
        status = finishOutcome.status;
        terminationReason = finishOutcome.terminationReason;
        break;
      }

      steps += 1;
      try {
        const explorationError = explorationRejection(decision.action, unchangedExplorationSteps);
        if (explorationError !== null) {
          steps -= 1;
          stagnationInterventions += 1;
          const rejection = { ok: false, error: explorationError };
          await events.write("tool_result", { action: decision.action.type, workspaceChanged: false, result: rejection });
          memory.recordObservation(decision.action, rejection);
          memory.recordGuidance(
            "Focused planning is finished. The next action must directly implement the GitHub issue with apply_patch, replace_text, or replace_file; use inspect_diff or finish only when appropriate. Preserve the issue description and constraints. Prefer replace_text for exact unique snippets; never send an empty search string; use replace_file only with complete corrected file text.",
          );
          if (stagnationInterventions >= budgets.maxStagnationInterventions) {
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

        await events.write("step_started", {
          step: steps,
          action: decision.action,
          ...(decision.intent === undefined ? {} : { intent: decision.intent }),
        });
        const observation = await dispatchAction({
          action: decision.action,
          repository,
          workspace,
          commandExecutor,
          checkpoints,
          readCache,
          memory,
          remainingTimeMs: Math.max(1, deadline - now()),
          before: lastState,
          signal: dependencies.signal,
        });
        lastState = observation.state;

        const obsOutcome = await processToolObservation(
          {
            action: decision.action,
            intent: decision.intent,
            observation,
            memory,
            progress,
            events,
            failures,
            verificationEvidence,
            trustedChecks: ctx.trustedChecks,
            maxStagnationInterventions: budgets.maxStagnationInterventions,
            maxRepairAttempts: budgets.maxRepairAttempts,
          },
          {
            verifiedPatchSha,
            diffReviewedPatchSha,
            unchangedExplorationSteps,
            stagnationInterventions,
            repairAttempts,
            lastVerification,
          },
        );

        verifiedPatchSha = obsOutcome.verifiedPatchSha;
        diffReviewedPatchSha = obsOutcome.diffReviewedPatchSha;
        unchangedExplorationSteps = obsOutcome.unchangedExplorationSteps;
        stagnationInterventions = obsOutcome.stagnationInterventions;
        repairAttempts = obsOutcome.repairAttempts;
        commandsRun += obsOutcome.commandsRunIncrement;
        checkpointsCreated += obsOutcome.checkpointsCreatedIncrement;
        checkpointsRestored += obsOutcome.checkpointsRestoredIncrement;
        verificationCommands += obsOutcome.verificationCommandsIncrement;
        lastVerification = obsOutcome.lastVerification;

        if (obsOutcome.shouldTerminate) {
          status = obsOutcome.status ?? status;
          terminationReason = obsOutcome.terminationReason ?? terminationReason;
          break;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const refreshed = await workspace.inspectChanges();
        const failure: FailureRecord = {
          sequence: failures.length + 1,
          kind: "tool",
          hypothesis: decision.intent ?? null,
          action: decision.action.type,
          detail,
          codeFingerprint: refreshed.ok ? refreshed.value.fingerprint : UNAVAILABLE_FINGERPRINT,
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
        if (!refreshed.ok) throw new Error(refreshed.error.message);
        lastState = refreshed.value;
      }
    }
  } catch (error) {
    status = "failed";
    terminationReason = `Harness error: ${error instanceof Error ? error.message : String(error)}`;
  }

  return await finalizeRun({
    context: ctx,
    task: options.task,
    maxRepairAttempts: budgets.maxRepairAttempts,
    repairAttempts,
    status,
    terminationReason,
    summary,
    steps,
    modelCalls,
    commandsRun,
    stagnationInterventions,
    verificationReserveActivations,
    verificationCommands,
    checkpointsCreated,
    checkpointsRestored,
    durationMs: Math.max(0, now() - startedAt),
    diffReviewedPatchSha,
    lastVerification,
  });
}
