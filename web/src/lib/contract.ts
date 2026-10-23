/**
 * The contract with the core, re-exported for the browser. Everything here is type-only except
 * the run-state reducer, whose module imports nothing at runtime, so it is safe to bundle.
 * The UI never redefines these shapes: when the core changes them, the typecheck fails here.
 */
import type { Capabilities, clientResult } from "@core/server/app";

export type { AgentEvent, AgentEventPayloads, AgentEventType, AgentStatus, UsageSummary } from "@core/agent/types";
export type { RunState, RunStepView } from "@core/agent/run-state";
export { INITIAL_RUN_STATE, reduceRunState } from "@core/agent/run-state";
export type { ApplyResult, RunView, RunRecordStatus } from "@core/service/run-service";
export type { Capabilities } from "@core/server/app";
export type { KeyTestResult, Provider, ProviderKeyView } from "@core/service/key-store";
export type { FollowUpRequest, RepoSource } from "@core/service/run-request";
export type { VerificationEvidence } from "@core/verification/types";
export type { ModelAction } from "@core/model/types";
export type { AgentRunRecord, ModelSummary, RunOutcome, Scorecard } from "@core/benchmark/agent-runs";

/** GET /api/runs/:id/result */
export type RunResultView = ReturnType<typeof clientResult>;

/** POST /api/runs body for a fresh run (budgets are optional; the server fills defaults). */
export interface StartRunBody {
  task: string;
  repo: { kind: "git"; url: string; ref?: string } | { kind: "local"; path: string };
  provider: import("@core/service/key-store").Provider;
  model?: string;
  budgets?: { maxSteps?: number; maxMinutes?: number; maxModelCalls?: number };
  verificationCommands?: string[];
  network?: "none" | "full";
}

/** POST /api/runs body for a follow-up. */
export interface FollowUpBody {
  parentRunId: string;
  task: string;
  budgets?: { maxSteps?: number; maxMinutes?: number; maxModelCalls?: number };
  verificationCommands?: string[];
  network?: "none" | "full";
}

/** PUT /api/providers/:p/key response. */
export interface SavedKeyView {
  provider: import("@core/service/key-store").Provider;
  last4: string | null;
  verified: boolean;
  test: import("@core/service/key-store").KeyTestResult;
}

/** GET /api/me. The same UI serves the hosted site and the desktop app; capabilities say which. */
export interface SessionView {
  userId: string;
  login: string;
  capabilities: Capabilities;
}

/** What a hosted server reports; used until /api/me answers, and for older servers without capabilities. */
export const HOSTED_CAPABILITIES: Capabilities = {
  mode: "hosted",
  sandbox: "docker",
  network: { default: "none", choices: ["none"] },
  repoKinds: ["git"],
  canApply: false,
};
