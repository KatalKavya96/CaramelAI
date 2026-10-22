import type { ModelAction } from "../model";
import type { AgentEvent, AgentStatus } from "./types";

export interface RunStepView {
  step: number;
  action: ModelAction;
  intent?: string;
  /** Absent while the step is still running. */
  outcome?: { ok: boolean; workspaceChanged: boolean; error?: string };
}

export interface RunState {
  runId: string | null;
  task: string | null;
  /** "running" until run_finished arrives with the final status. */
  status: "starting" | "running" | AgentStatus;
  terminationReason: string | null;
  steps: RunStepView[];
  /** Actions the harness rejected before running them (budget reserve, stagnation, finish gate). */
  rejections: { action: ModelAction["type"]; error: string }[];
  modelErrors: { kind: string; message: string }[];
  changedFiles: string[];
  successfulFinalState: boolean;
  /** Sequence of the last event applied; a reconnecting viewer resumes after it. */
  lastSequence: number;
}

export const INITIAL_RUN_STATE: RunState = {
  runId: null,
  task: null,
  status: "starting",
  terminationReason: null,
  steps: [],
  rejections: [],
  modelErrors: [],
  changedFiles: [],
  successfulFinalState: false,
  lastSequence: 0,
};

function resultOk(result: unknown): boolean {
  return !(typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === false);
}

function resultError(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const error = (result as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return undefined;
}

/**
 * Pure reducer from events to what a viewer shows. The server and the browser run the same
 * function, so state rebuilt from events.jsonl after a reload equals the state a live viewer had.
 * Events at or below lastSequence are ignored, which makes replaying an overlap safe.
 */
export function reduceRunState(state: RunState, event: AgentEvent): RunState {
  if (event.sequence <= state.lastSequence) return state;
  const next: RunState = { ...state, lastSequence: event.sequence };
  switch (event.type) {
    case "run_started":
      return { ...next, runId: event.payload.runId, task: event.payload.task, status: "running" };
    case "model_decision":
      return next;
    case "model_error":
      return { ...next, modelErrors: [...state.modelErrors, { kind: event.payload.kind, message: event.payload.message }] };
    case "step_started": {
      const step: RunStepView = { step: event.payload.step, action: event.payload.action };
      if (event.payload.intent !== undefined) step.intent = event.payload.intent;
      return { ...next, steps: [...state.steps, step] };
    }
    case "tool_result": {
      const last = state.steps.at(-1);
      const error = event.payload.error ?? resultError(event.payload.result);
      if (last === undefined || last.outcome !== undefined) {
        return { ...next, rejections: [...state.rejections, { action: event.payload.action, error: error ?? "rejected" }] };
      }
      const outcome: NonNullable<RunStepView["outcome"]> = {
        ok: event.payload.error === undefined && resultOk(event.payload.result),
        workspaceChanged: event.payload.workspaceChanged,
      };
      if (error !== undefined) outcome.error = error;
      return { ...next, steps: [...state.steps.slice(0, -1), { ...last, outcome }] };
    }
    case "run_finished":
      return {
        ...next,
        status: event.payload.status,
        terminationReason: event.payload.terminationReason,
        changedFiles: event.payload.changedFiles,
        successfulFinalState: event.payload.successfulFinalState,
      };
  }
}

/** Rebuilds state from an events.jsonl file's contents. */
export function replayRunState(eventsJsonl: string): RunState {
  return eventsJsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AgentEvent)
    .reduce(reduceRunState, INITIAL_RUN_STATE);
}
