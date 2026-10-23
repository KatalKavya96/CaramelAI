import { ModelError, type ModelAdapter, type ModelDecision } from "../model";
import type { TaskMemory } from "../memory";
import type { FailureRecord } from "../recovery";
import type { AgentEventWriter } from "./events";
import { statusForModelError } from "./policy";
import { recordUsage, type AgentStatus, type UsageSummary } from "./types";

export interface ModelTurnContext {
  model: ModelAdapter;
  memory: TaskMemory;
  /** Fingerprint of the workspace while the model thinks; a model call never changes it. */
  codeFingerprint: string;
  events: AgentEventWriter;
  usage: UsageSummary;
  failures: FailureRecord[];
  maxModelCalls: number;
  remainingTimeMs: number;
  signal?: AbortSignal | undefined;
}

export type ModelTurnResult =
  | { kind: "decision"; decision: ModelDecision }
  | { kind: "retry"; refundCall: boolean; incrementInvalidResponses: boolean }
  | { kind: "terminate"; status: AgentStatus; terminationReason: string };

export async function executeModelTurn(
  ctx: ModelTurnContext,
  state: {
    modelCalls: number;
    consecutiveInvalidResponses: number;
  },
): Promise<ModelTurnResult> {
  const { model, memory, codeFingerprint, events, usage, failures, maxModelCalls, remainingTimeMs } = ctx;

  const startedAt = performance.now();
  try {
    const turn = await model.complete(memory.request(), {
      remainingTimeMs,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    }).finally(() => {
      usage.modelTimeMs += Math.round(performance.now() - startedAt);
    });
    for (const spent of turn.wastedUsage ?? []) recordUsage(usage, spent);
    recordUsage(usage, turn.usage);
    await events.write("model_decision", turn.decision);
    memory.recordDecision(turn.decision);
    return { kind: "decision", decision: turn.decision };
  } catch (error) {
    const modelError =
      error instanceof ModelError
        ? error
        : new ModelError("transport", error instanceof Error ? error.message : String(error), false, 1, { cause: error });
    // A failed call can still have been billed (e.g. an unparseable reply).
    for (const spent of modelError.usage) recordUsage(usage, spent);

    await events.write("model_error", {
      kind: modelError.kind,
      message: modelError.message,
      attempts: modelError.attempts,
    });

    const failure: FailureRecord = {
      sequence: failures.length + 1,
      kind: "model",
      hypothesis: null,
      action: "model_call",
      detail: `${modelError.kind}: ${modelError.message}`,
      codeFingerprint,
      countsAgainstRepairLimit: false,
    };
    failures.push(failure);
    memory.recordFailure(failure);

    if (modelError.kind === "invalid_response" && state.modelCalls < maxModelCalls) {
      if (state.consecutiveInvalidResponses + 1 <= 3) {
        memory.recordInvalidResponse(modelError.message);
        return { kind: "retry", refundCall: true, incrementInvalidResponses: true };
      }
    }

    if (modelError.retryable && state.modelCalls < maxModelCalls) {
      memory.recordGuidance(
        `The prior provider call failed transiently: ${modelError.message}. Continue from the latest observed state with one valid structured action.`,
      );
      return { kind: "retry", refundCall: false, incrementInvalidResponses: false };
    }

    return {
      kind: "terminate",
      status: statusForModelError(modelError),
      terminationReason: `Model error (${modelError.kind}): ${modelError.message}`,
    };
  }
}
