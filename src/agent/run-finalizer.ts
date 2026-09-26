import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandResult } from "../execution";
import { evidenceForFinalState } from "../verification";
import { currentState } from "./action-dispatcher";
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
        : "Model requested finish without successful verification for the final changed state.";

  return { status, terminationReason };
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

  const finalState = await currentState(workspace);
  const finalEvidence = evidenceForFinalState(context.verificationEvidence, finalState.patchSha256);
  const successfulFinalState =
    finalState.changedFiles.length > 0 &&
    finalEvidence.at(-1)?.status === "passed" &&
    options.diffReviewedPatchSha === finalState.patchSha256;

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
      diffReviewedForFinalState: options.diffReviewedPatchSha === finalState.patchSha256,
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

  await writeFile(reportPath, renderEvidenceReport(result, finalState.patchSha256));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);

  return result;
}
