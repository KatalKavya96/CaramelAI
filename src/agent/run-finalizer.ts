import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandResult } from "../execution";
import { finalStateVerified } from "../verification";
import { UNAVAILABLE_FINGERPRINT } from "./action-dispatcher";
import type { InitializedRunContext } from "./run-init";
import { renderEvidenceReport } from "./report";
import type { AgentRunResult, AgentStatus } from "./types";

export interface FinalizeRunOptions {
  context: InitializedRunContext;
  task: string;
  maxRepairAttempts: number;
  repairAttempts: number;
  status: AgentStatus;
  terminationReason: string;
  summary: string;
  steps: number;
  modelCalls: number;
  commandsRun: number;
  stagnationInterventions: number;
  verificationReserveActivations: number;
  verificationCommands: number;
  checkpointsCreated: number;
  checkpointsRestored: number;
  durationMs: number;
  diffReviewedPatchSha: string | null;
  lastVerification: CommandResult | null;
}

export function evaluateFinishDecision(
  changedFilesCount: number,
  patchSha256: string,
  verifiedPatchSha: string | null,
  diffReviewedPatchSha: string | null,
  /** False when the repository has no test, build or lint command: nothing could have verified it. */
  hasTrustedChecks = true,
): { status: AgentStatus; terminationReason: string } {
  const verified =
    changedFilesCount > 0 &&
    verifiedPatchSha !== null &&
    verifiedPatchSha === patchSha256 &&
    diffReviewedPatchSha === patchSha256;

  const status: AgentStatus = verified ? "verified" : "partial";
  const terminationReason = verified
    ? "Model requested finish with successful verification for the final code state."
    : changedFilesCount === 0
      ? "Model requested finish without producing code changes."
      : diffReviewedPatchSha !== patchSha256
        ? "Model requested finish without reviewing the final diff."
        : hasTrustedChecks
          ? "Model requested finish without successful verification for the final changed state."
          // Not the agent's failure: say so, and how to make the next run verifiable.
          : "No verification available: this repository has no test, build or lint command. Add one under Checks to verify runs here.";

  return { status, terminationReason };
}

/** How many times an incomplete finish is sent back before it is accepted as partial. */
export const MAX_FINISH_REJECTIONS = 2;

/** Concrete steps the model can still take to make a finish verifiable. */
export function missingFinishRequirements(state: {
  changedFiles: number;
  fingerprint: string;
  verifiedPatchSha: string | null;
  diffReviewedPatchSha: string | null;
  trustedCommands: readonly string[];
}): string[] {
  if (state.changedFiles === 0) return [];
  const missing: string[] = [];
  if (state.diffReviewedPatchSha !== state.fingerprint) {
    missing.push("Review the final changes with inspect_diff.");
  }
  if (state.verifiedPatchSha !== state.fingerprint && state.trustedCommands.length > 0) {
    missing.push(
      `Run a trusted verification command on the final code and make it pass: ${state.trustedCommands.join(", ")}.`,
    );
  }
  return missing;
}

export async function finalizeRun(options: FinalizeRunOptions): Promise<AgentRunResult> {
  const { context } = options;
  const { workspace, events } = context;

  let status = options.status;
  let terminationReason = options.terminationReason;

  const exported = await workspace.exportPatch();
  if (!exported.ok) {
    status = "failed";
    terminationReason = `Patch export failed: ${exported.error.message}`;
  }

  const exportValue = exported.ok
    ? exported.value
    : { patchPath: resolve(workspace.runRoot, "patch.diff"), changedFiles: [] };

  const inspected = await workspace.inspectChanges();
  const finalState = inspected.ok
    ? inspected.value
    : { fingerprint: UNAVAILABLE_FINGERPRINT, changedFiles: [] };
  if (!inspected.ok && status !== "failed") {
    status = "failed";
    terminationReason = `Final workspace state is unreadable: ${inspected.error.message}`;
  }
  const successfulFinalState =
    finalState.changedFiles.length > 0 &&
    finalStateVerified(context.verificationEvidence, finalState.fingerprint) &&
    options.diffReviewedPatchSha === finalState.fingerprint;

  const resultPath = resolve(workspace.runRoot, "result.json");
  const reportPath = resolve(workspace.runRoot, "report.md");

  const result: AgentRunResult = {
    runId: context.runId,
    status,
    terminationReason,
    summary: options.summary,
    task: options.task,
    sourceRepo: workspace.sourcePath,
    workspacePath: workspace.workspacePath,
    resultPath,
    eventsPath: events.path,
    patchPath: exportValue.patchPath,
    reportPath,
    changedFiles: exportValue.changedFiles,
    verification: {
      commandsRun: options.verificationCommands,
      successfulFinalState,
      diffReviewedForFinalState: options.diffReviewedPatchSha === finalState.fingerprint,
      discoveredChecks: context.discoveredChecks,
      evidence: context.verificationEvidence,
      lastResult: options.lastVerification,
    },
    recovery: {
      maxRepairAttempts: options.maxRepairAttempts,
      repairAttempts: options.repairAttempts,
      failures: context.failures,
      checkpointsCreated: options.checkpointsCreated,
      checkpointsRestored: options.checkpointsRestored,
    },
    memory: context.memory.snapshot(),
    metrics: {
      steps: options.steps,
      modelCalls: options.modelCalls,
      commandsRun: options.commandsRun,
      stagnationInterventions: options.stagnationInterventions,
      verificationReserveActivations: options.verificationReserveActivations,
      durationMs: options.durationMs,
    },
    usage: context.usage,
  };

  await events.write("run_finished", {
    status: result.status,
    terminationReason: result.terminationReason,
    changedFiles: result.changedFiles,
    successfulFinalState,
  });

  await writeFile(reportPath, renderEvidenceReport(result, finalState.fingerprint));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

  return result;
}
