import { ModelError, type ModelAdapter, type ModelDecision } from "../model";
import type { TaskMemory } from "../memory";
import type { FailureRecord } from "../recovery";
import type { IsolatedWorkspace } from "../workspace";
import { currentState } from "./action-dispatcher";
import type { AgentEventWriter } from "./events";
import { statusForModelError } from "./policy";
import { recordUsage, type AgentStatus, type UsageSummary } from "./types";

export interface ModelTurnContext {
  model: ModelAdapter;
  memory: TaskMemory;
  workspace: IsolatedWorkspace;
  events: AgentEventWriter;
  usage: UsageSummary;
  failures: FailureRecord[];
  maxModelCalls: number;
  remainingTimeMs: number;
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
  const { model, memory, workspace, events, usage, failures, maxModelCalls, remainingTimeMs } = ctx;

  try {
    const turn = await model.complete(memory.request(), { remainingTimeMs });
    recordUsage(usage, turn.usage);
    await events.write("model_decision", turn.decision);
    memory.recordDecision(turn.decision);
    return { kind: "decision", decision: turn.decision };
  } catch (error) {
    const modelError =
      error instanceof ModelError
        ? error
        : new ModelError("transport", error instanceof Error ? error.message : String(error), false, 1, { cause: error });

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
      codeFingerprint: (await currentState(workspace)).patchSha256,
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
