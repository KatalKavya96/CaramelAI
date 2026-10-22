import { INITIAL_RUN_STATE, reduceRunState, type AgentEvent, type AgentEventPayloads, type AgentStatus, type RunState } from "../lib/contract";

/** What a command step printed, taken from its tool_result. */
export interface StepOutput {
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  truncated: boolean;
}

/**
 * The core's RunState plus the few things the run screen shows that the core reducer does not
 * keep (budgets, model calls, timings, command output). It wraps reduceRunState rather than
 * copying it, so the step logic stays in one place.
 */
export interface LiveRunState {
  run: RunState;
  budgets: AgentEventPayloads["run_started"]["budgets"] | null;
  parentRunId: string | null;
  modelCalls: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** When each step started, keyed by step number, for the live elapsed timer. */
  stepStartedAt: Record<number, string>;
  stepOutputs: Record<number, StepOutput>;
  /** Set by a run_closed event: the run ended without an agent log (clone failure, cancelled while queued). */
  closedStatus: AgentStatus | null;
}

export const INITIAL_LIVE_RUN: LiveRunState = {
  run: INITIAL_RUN_STATE,
  budgets: null,
  parentRunId: null,
  modelCalls: 0,
  startedAt: null,
  finishedAt: null,
  stepStartedAt: {},
  stepOutputs: {},
  closedStatus: null,
};

function commandOutput(result: unknown): StepOutput | null {
  if (typeof result !== "object" || result === null) return null;
  const value = result as { exitCode?: unknown; durationMs?: unknown; stdout?: { preview?: unknown; previewTruncated?: unknown }; stderr?: { preview?: unknown; previewTruncated?: unknown } };
  if (value.stdout === undefined && value.stderr === undefined) return null;
  const stdout = typeof value.stdout?.preview === "string" ? value.stdout.preview : "";
  const stderr = typeof value.stderr?.preview === "string" ? value.stderr.preview : "";
  return {
    exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
    output: [stdout, stderr].filter((part) => part.trim() !== "").join("\n"),
    truncated: value.stdout?.previewTruncated === true || value.stderr?.previewTruncated === true,
  };
}

export function reduceLiveRun(state: LiveRunState, event: AgentEvent): LiveRunState {
  if (event.sequence <= state.run.lastSequence) return state;
  const run = reduceRunState(state.run, event);
  const next: LiveRunState = { ...state, run };
  switch (event.type) {
    case "run_started":
      return { ...next, budgets: event.payload.budgets, parentRunId: event.payload.parentRunId ?? null, startedAt: event.timestamp };
    case "model_decision":
    case "model_error":
      return { ...next, modelCalls: state.modelCalls + 1 };
    case "step_started":
      return { ...next, stepStartedAt: { ...state.stepStartedAt, [event.payload.step]: event.timestamp } };
    case "tool_result": {
      const last = state.run.steps.at(-1);
      if (last === undefined || last.outcome !== undefined || event.payload.action !== "run_command") return next;
      const output = commandOutput(event.payload.result);
      return output === null ? next : { ...next, stepOutputs: { ...state.stepOutputs, [last.step]: output } };
    }
    case "run_finished":
      return { ...next, finishedAt: event.timestamp };
  }
}
