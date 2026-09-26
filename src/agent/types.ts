import type { CommandRequest, CommandResult } from "../execution";
import type { ModelUsage } from "../model";
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

export type AgentStatus = "verified" | "partial" | "blocked" | "budget_exhausted" | "failed";

export type AgentEventType =
  | "run_started"
  | "model_decision"
  | "model_error"
  | "tool_result"
  | "run_finished";

export interface AgentEvent {
  sequence: number;
  timestamp: string;
  type: AgentEventType;
  payload: unknown;
}

export interface UsageSummary {
  providerInputTokens: number;
  providerOutputTokens: number;
  providerTotalTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  unavailableCalls: number;
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
    return;
  }
  summary.estimatedInputTokens += usage.inputTokens;
  summary.estimatedOutputTokens += usage.outputTokens;
  summary.estimatedTotalTokens += usage.totalTokens;
}
