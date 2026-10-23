export type ModelRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: ModelRole;
  content: string;
}

/** A JSON Schema the provider should constrain its output to, when it supports that. */
export interface ResponseFormat {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface ModelRequest {
  messages: readonly ModelMessage[];
  /** Defaults to the coding-action decision schema. */
  responseFormat?: ResponseFormat;
}

export type ModelAction =
  | { type: "list_files"; path?: string; maxDepth?: number }
  | { type: "search"; query: string; path?: string; maxResults?: number }
  | { type: "read_file"; path: string; startLine?: number; endLine?: number }
  | { type: "apply_patch"; patch: string }
  | { type: "replace_text"; path: string; search: string; replacement: string }
  | { type: "replace_file"; path: string; content: string }
  | { type: "create_checkpoint"; label: string }
  | { type: "restore_checkpoint"; checkpointId: string }
  | {
      type: "run_command";
      command: string;
      purpose?: "setup" | "agent" | "verification";
      cwd?: string;
      timeoutMs?: number;
    }
  | { type: "inspect_diff" }
  | { type: "finish"; summary: string };

export interface ModelDecision {
  intent?: string;
  action: ModelAction;
}

export type ModelUsage =
  | {
      source: "provider" | "estimated";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      /** Input tokens served from the provider's prompt cache, which are billed at a discount. */
      cachedInputTokens?: number;
      /** What the provider says it charged, in US dollars. Absent when it does not report cost. */
      costUsd?: number;
    }
  | { source: "unavailable" };

export interface ModelTurn {
  decision: ModelDecision;
  usage: ModelUsage;
  /** Usage of earlier attempts in this call that the provider answered but that failed and were retried. */
  wastedUsage?: ModelUsage[];
}

/** Raw model text plus usage, for callers that validate the output themselves (plan mode). */
export interface TextTurn {
  output: string;
  usage: ModelUsage;
  wastedUsage?: ModelUsage[];
}

export interface CompletionBudget {
  remainingTimeMs?: number;
  /** Aborting cancels the in-flight request and any pending retry. */
  signal?: AbortSignal;
}

export interface ModelAdapter {
  complete(request: ModelRequest, budget?: CompletionBudget): Promise<ModelTurn>;
  /** Same timeout, retry and error handling as complete(), without decision parsing. */
  completeText?(request: ModelRequest, budget?: CompletionBudget): Promise<TextTurn>;
}
