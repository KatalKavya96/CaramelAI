/**
 * Every reason a run can stop, in one place. The web app, reports and benchmark scorecards show
 * these strings, so wording changes here are user-visible.
 */
export const TERMINATION = {
  controllerStopped: "Controller stopped unexpectedly.",
  cancelled: "Run cancelled by the user.",
  cancelledBeforeStart: "Cancelled before it started.",
  serverStopped: "The server stopped while this run was active.",
  wallClockBudget: "Wall-clock budget exhausted.",
  stepBudget: "Step budget exhausted.",
  modelCallBudget: "Model-call budget exhausted.",
  repeatedActions: "Stagnation limit reached after repeated unchanged actions.",
  explorationWithoutChanges: "Stagnation limit reached after repeated exploration without code changes.",
  finishVerified: "Model requested finish with successful verification for the final code state.",
  finishWithoutChanges: "Model requested finish without producing code changes.",
  finishWithoutDiffReview: "Model requested finish without reviewing the final diff.",
  finishWithoutVerification: "Model requested finish without successful verification for the final changed state.",
  // Not the agent's failure: say so, and how to make the next run verifiable.
  noVerificationAvailable:
    "No verification available: this repository has no test, build or lint command. Add one under Checks to verify runs here.",
  repairLimit: (attempts: number) => `Repair limit reached after ${attempts} code-related failures.`,
  modelError: (kind: string, message: string) => `Model error (${kind}): ${message}`,
  harnessError: (message: string) => `Harness error: ${message}`,
  patchExportFailed: (message: string) => `Patch export failed: ${message}`,
  workspaceUnreadable: (message: string) => `Final workspace state is unreadable: ${message}`,
} as const;
