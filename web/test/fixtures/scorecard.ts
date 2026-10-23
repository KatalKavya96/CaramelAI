import type { AgentRunRecord, ModelSummary, Scorecard } from "../../src/lib/contract";

const run = (patch: Partial<AgentRunRecord> & Pick<AgentRunRecord, "taskId" | "model" | "outcome">): AgentRunRecord => ({
  split: "development",
  attempt: 1,
  agentStatus: "verified",
  claimedVerified: true,
  taskCheckPassed: patch.outcome === "solved",
  regressionCheckPassed: true,
  terminationReason: "verified",
  durationMs: 60_000,
  modelTimeMs: 40_000,
  steps: 8,
  modelCalls: 8,
  tokens: { input: 20_000, output: 2_000, total: 22_000, cachedInput: 5_000 },
  costUsd: 0.02,
  directory: `runs/${patch.model.replace("/", "_")}/${patch.taskId}/1`,
  ...patch,
});

const summary = (patch: Partial<ModelSummary> & Pick<ModelSummary, "model">): ModelSummary => ({
  attempted: 2,
  providerErrors: 0,
  scored: 2,
  solved: 1,
  solveRate: 0.5,
  solveRateBySplit: { development: 1, heldOut: 0 },
  verifiedClaims: 2,
  falseSuccesses: 1,
  falseSuccessRate: 0.5,
  regressions: 0,
  regressionRate: 0,
  costUsd: 0.04,
  costComplete: true,
  costPerSolvedUsd: 0.04,
  tokensPerSolved: 44_000,
  durationPerSolvedMs: 120_000,
  modelTimeShare: 0.66,
  cacheHitShare: 0.25,
  perTask: [
    { taskId: "ts-receipt-rounding", split: "development", attempts: 1, solved: 1 },
    { taskId: "py-not-a-bug", split: "held_out", attempts: 1, solved: 0 },
  ],
  ...patch,
});

/** Two models, one overconfident on a held-out task, and a budget stop. */
export const SCORECARD: Scorecard = {
  schemaVersion: 1,
  recordedAt: "2026-10-23T09:00:00.000Z",
  harnessRevision: "30edb21aa",
  taskSetSha256: "abc",
  provider: "openrouter",
  repeats: 1,
  maxCostUsd: 5,
  stoppedEarly: "The $5.00 spending limit was reached.",
  models: [
    summary({ model: "x-ai/grok-4" }),
    summary({
      model: "qwen/qwen3-coder:free",
      solved: 2,
      solveRate: 1,
      solveRateBySplit: { development: 1, heldOut: 1 },
      verifiedClaims: 2,
      falseSuccesses: 0,
      falseSuccessRate: 0,
      costUsd: 0,
      costPerSolvedUsd: 0,
      perTask: [
        { taskId: "ts-receipt-rounding", split: "development", attempts: 1, solved: 1 },
        { taskId: "py-not-a-bug", split: "held_out", attempts: 1, solved: 1 },
      ],
    }),
  ],
  runs: [
    run({ taskId: "ts-receipt-rounding", model: "x-ai/grok-4", outcome: "solved" }),
    run({ taskId: "py-not-a-bug", split: "held_out", model: "x-ai/grok-4", outcome: "unsolved" }),
    run({ taskId: "ts-receipt-rounding", model: "qwen/qwen3-coder:free", outcome: "solved", costUsd: 0 }),
    run({ taskId: "py-not-a-bug", split: "held_out", model: "qwen/qwen3-coder:free", outcome: "solved", costUsd: 0 }),
    run({ taskId: "ts-timezone-date", split: "held_out", model: "qwen/qwen3-coder:free", outcome: "skipped_budget", agentStatus: null, claimedVerified: false, taskCheckPassed: null, regressionCheckPassed: null }),
  ],
};
