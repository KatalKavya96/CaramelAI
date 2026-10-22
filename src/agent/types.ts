import type { CommandRequest, CommandResult } from "../execution";
import type { ModelAction, ModelDecision, ModelErrorKind, ModelUsage } from "../model";
import type { DiscoveredCheck, VerificationEvidence } from "../verification";
import type { RecoverySummary } from "../recovery";
import type { TaskMemorySnapshot } from "../memory";

export interface PlanQuestion {
  question: string;
  options: string[];
  defaultIndex?: number | undefined;
  allowCustom: boolean;
}

export interface PlanAnswer {
  question: string;
  answer: string;
  isCustom: boolean;
}

export interface AgentPlan {
  summary: string;
  questions: PlanQuestion[];
  answers: PlanAnswer[];
}

export type AgentStatus = "verified" | "partial" | "blocked" | "budget_exhausted" | "failed" | "cancelled";

/** Bumped when an event payload changes shape, so readers of old events.jsonl files can tell. */
export const AGENT_EVENT_SCHEMA_VERSION = 1;

/** The payload of every event type. This map is the contract between the run and any viewer. */
export interface AgentEventPayloads {
  run_started: {
    runId: string;
    task: string;
    sourceRepo: string;
    workspacePath: string;
    budgets: { maxSteps: number; maxMinutes: number; maxModelCalls: number };
    /** Set when this run continues an earlier run's result. */
    parentRunId?: string;
  };
  model_decision: ModelDecision;
  model_error: { kind: ModelErrorKind; message: string; attempts: number };
  /** Written before an action runs, so a viewer can show what is in progress. */
  step_started: { step: number; action: ModelAction; intent?: string };
  tool_result: {
    action: ModelAction["type"];
    workspaceChanged: boolean;
    result?: unknown;
    error?: string;
  };
  run_finished: {
    status: AgentStatus;
    terminationReason: string;
    changedFiles: string[];
    successfulFinalState: boolean;
  };
}

export type AgentEventType = keyof AgentEventPayloads;

/** A discriminated union: narrowing on `type` gives the matching payload type. */
export type AgentEvent = {
  [K in AgentEventType]: {
    schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
    sequence: number;
    timestamp: string;
    type: K;
    payload: AgentEventPayloads[K];
  };
}[AgentEventType];

export interface UsageSummary {
  providerInputTokens: number;
  providerOutputTokens: number;
  providerTotalTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  unavailableCalls: number;
  /** Provider-reported input tokens that were cache hits. */
  cachedInputTokens: number;
  /** Sum of the cost providers reported. A lower bound when costUnknownCalls > 0. */
  providerCostUsd: number;
  /** Calls whose tokens were counted but whose cost the provider did not report. */
  costUnknownCalls: number;
  /** Wall time spent waiting on the model, including failed calls and retries. */
  modelTimeMs: number;
}

export interface AgentRunResult {
  runId: string;
  status: AgentStatus;
  terminationReason: string;
  summary: string;
  task: string;
  sourceRepo: string;
  workspacePath: string;
  resultPath: string;
  eventsPath: string;
  patchPath: string;
  reportPath: string;
  changedFiles: string[];
  verification: {
    commandsRun: number;
    successfulFinalState: boolean;
    diffReviewedForFinalState: boolean;
    discoveredChecks: DiscoveredCheck[];
    evidence: VerificationEvidence[];
    lastResult: CommandResult | null;
  };
  recovery: RecoverySummary;
  memory: TaskMemorySnapshot;
  metrics: {
    steps: number;
    modelCalls: number;
    commandsRun: number;
    stagnationInterventions: number;
    verificationReserveActivations: number;
    durationMs: number;
  };
  usage: UsageSummary;
}

export interface CommandExecutor {
  run(request: CommandRequest): Promise<CommandResult>;
}

export function emptyUsageSummary(): UsageSummary {
  return {
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerTotalTokens: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedTotalTokens: 0,
    unavailableCalls: 0,
    cachedInputTokens: 0,
    providerCostUsd: 0,
    costUnknownCalls: 0,
    modelTimeMs: 0,
  };
}

export function recordUsage(summary: UsageSummary, usage: ModelUsage): void {
  if (usage.source === "unavailable") {
    summary.unavailableCalls += 1;
    return;
  }
  if (usage.source === "provider") {
    summary.providerInputTokens += usage.inputTokens;
    summary.providerOutputTokens += usage.outputTokens;
    summary.providerTotalTokens += usage.totalTokens;
    summary.cachedInputTokens += usage.cachedInputTokens ?? 0;
    if (usage.costUsd === undefined) summary.costUnknownCalls += 1;
    else summary.providerCostUsd += usage.costUsd;
    return;
  }
  summary.estimatedInputTokens += usage.inputTokens;
  summary.estimatedOutputTokens += usage.outputTokens;
  summary.estimatedTotalTokens += usage.totalTokens;
}
