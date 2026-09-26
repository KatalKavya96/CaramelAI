import { z } from "zod";
import type { ModelAction, ModelDecision, ModelUsage } from "./types";

export class ModelResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelResponseValidationError";
  }
}

export const ListFilesActionSchema = z.object({
  type: z.literal("list_files"),
  path: z.string().min(1).optional(),
  maxDepth: z.number().int().positive().optional(),
});

export const SearchActionSchema = z.object({
  type: z.literal("search"),
  query: z.string().min(1, "action.query must be a non-empty string."),
  path: z.string().min(1).optional(),
  maxResults: z.number().int().positive().optional(),
});

export const ReadFileActionSchema = z.object({
  type: z.literal("read_file"),
  path: z.string().min(1, "action.path must be a non-empty string."),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
}).refine(
  (data) => data.startLine === undefined || data.endLine === undefined || data.endLine >= data.startLine,
  { message: "action.endLine must be greater than or equal to action.startLine." },
);

export const ApplyPatchActionSchema = z.object({
  type: z.literal("apply_patch"),
  patch: z.string().min(1, "action.patch must be a non-empty string."),
});

export const ReplaceTextActionSchema = z.object({
  type: z.literal("replace_text"),
  path: z.string().min(1, "action.path must be a non-empty string."),
  search: z.string().min(1, "action.search must be a non-empty string."),
  replacement: z.string({ message: "action.replacement must be a string." }),
});

export const ReplaceFileActionSchema = z.object({
  type: z.literal("replace_file"),
  path: z.string().min(1, "action.path must be a non-empty string."),
  content: z.string({ message: "action.content must be a string." }),
});

export const CreateCheckpointActionSchema = z.object({
  type: z.literal("create_checkpoint"),
  label: z.string().min(1, "action.label must be a non-empty string."),
});

export const RestoreCheckpointActionSchema = z.object({
  type: z.literal("restore_checkpoint"),
  checkpointId: z.string().min(1, "action.checkpointId must be a non-empty string."),
});

export const RunCommandActionSchema = z.object({
  type: z.literal("run_command"),
  command: z.string().min(1, "action.command must be a non-empty string."),
  purpose: z.enum(["setup", "agent", "verification"], {
    message: "action.purpose must be setup, agent, or verification.",
  }).optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const InspectDiffActionSchema = z.object({
  type: z.literal("inspect_diff"),
});

export const FinishActionSchema = z.object({
  type: z.literal("finish"),
  summary: z.string({ message: "action.summary must be a string." }),
});

export const ModelActionSchema = z.discriminatedUnion("type", [
  ListFilesActionSchema,
  SearchActionSchema,
  ReadFileActionSchema,
  ApplyPatchActionSchema,
  ReplaceTextActionSchema,
  ReplaceFileActionSchema,
  CreateCheckpointActionSchema,
  RestoreCheckpointActionSchema,
  RunCommandActionSchema,
  InspectDiffActionSchema,
  FinishActionSchema,
]);

export const ModelDecisionSchema = z.object({
  intent: z.string().optional(),
  action: ModelActionSchema,
});

export const ProviderUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ModelResponseValidationError(`${location} must be an object.`);
  }
  return value;
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function decodeJson(value: string): unknown {
  const trimmed = value.trim();

  // 1. Try direct parse (ideal case)
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  // 2. Try extracting from markdown fenced blocks (``` or ```json or ```JSON)
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(trimmed);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }

  // 3. Try extracting the first balanced JSON object from the text
  const extracted = extractBalancedJson(trimmed);
  if (extracted !== null) {
    try { return JSON.parse(extracted); } catch { /* continue */ }
  }

  throw new ModelResponseValidationError("Model output must be valid JSON.");
}

function normalizeAction(response: Record<string, unknown>): unknown {
  let action = response.action;
  if (typeof action === "string") {
    const trimmed = action.trim();
    if (trimmed.startsWith("{")) action = decodeJson(trimmed);
    else {
      const { intent: _intent, action: _action, ...argumentsFromTopLevel } = response;
      action = { type: trimmed, ...argumentsFromTopLevel };
    }
  }
  if (!isRecord(action)) return action;
  if (action.type === "command") {
    return {
      ...action,
      type: "run_command",
      command: action.command ?? action.cmd,
    };
  }
  return action;
}

function requiredString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ModelResponseValidationError(`${location} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, location: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, location);
}

function optionalPositiveInteger(value: unknown, location: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ModelResponseValidationError(`${location} must be a positive integer.`);
  }
  return value;
}

function withOptional<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): T & Partial<Record<K, V>> {
  return value === undefined ? target : Object.assign(target, { [key]: value });
}

function parseAction(value: unknown): ModelAction {
  const action = record(value, "action");
  const type = requiredString(action.type, "action.type");

  switch (type) {
    case "list_files": {
      const result: { type: "list_files"; path?: string; maxDepth?: number } = {
        type: "list_files",
      };
      withOptional(result, "path", optionalString(action.path, "action.path"));
      withOptional(result, "maxDepth", optionalPositiveInteger(action.maxDepth, "action.maxDepth"));
      return result;
    }
    case "search": {
      const result: { type: "search"; query: string; path?: string; maxResults?: number } = {
        type: "search",
        query: requiredString(action.query, "action.query"),
      };
      withOptional(result, "path", optionalString(action.path, "action.path"));
      withOptional(
        result,
        "maxResults",
        optionalPositiveInteger(action.maxResults, "action.maxResults"),
      );
      return result;
    }
    case "read_file": {
      const startLine = optionalPositiveInteger(action.startLine, "action.startLine");
      const endLine = optionalPositiveInteger(action.endLine, "action.endLine");
      if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
        throw new ModelResponseValidationError(
          "action.endLine must be greater than or equal to action.startLine.",
        );
      }
      const result: {
        type: "read_file";
        path: string;
        startLine?: number;
        endLine?: number;
      } = {
        type: "read_file",
        path: requiredString(action.path, "action.path"),
      };
      withOptional(result, "startLine", startLine);
      withOptional(result, "endLine", endLine);
      return result;
    }
    case "apply_patch":
      return { type: "apply_patch", patch: requiredString(action.patch, "action.patch") };
    case "replace_text":
      return {
        type: "replace_text",
        path: requiredString(action.path, "action.path"),
        search: requiredString(action.search, "action.search"),
        replacement: typeof action.replacement === "string"
          ? action.replacement
          : (() => { throw new ModelResponseValidationError("action.replacement must be a string."); })(),
      };
    case "replace_file":
      return {
        type: "replace_file",
        path: requiredString(action.path, "action.path"),
        content: typeof action.content === "string"
          ? action.content
          : (() => { throw new ModelResponseValidationError("action.content must be a string."); })(),
      };
    case "create_checkpoint":
      return { type: "create_checkpoint", label: requiredString(action.label, "action.label") };
    case "restore_checkpoint":
      return {
        type: "restore_checkpoint",
        checkpointId: requiredString(action.checkpointId, "action.checkpointId"),
      };
    case "run_command": {
      const result: {
        type: "run_command";
        command: string;
        purpose?: "setup" | "agent" | "verification";
        cwd?: string;
        timeoutMs?: number;
      } = {
        type: "run_command",
        command: requiredString(action.command, "action.command"),
      };
      if (action.purpose !== undefined) {
        if (
          action.purpose !== "setup" &&
          action.purpose !== "agent" &&
          action.purpose !== "verification"
        ) {
          throw new ModelResponseValidationError(
            "action.purpose must be setup, agent, or verification.",
          );
        }
        result.purpose = action.purpose;
      }
      withOptional(result, "cwd", optionalString(action.cwd, "action.cwd"));
      withOptional(
        result,
        "timeoutMs",
        optionalPositiveInteger(action.timeoutMs, "action.timeoutMs"),
      );
      return result;
    }
    case "inspect_diff":
      return { type: "inspect_diff" };
    case "finish":
      return { type: "finish", summary: requiredString(action.summary, "action.summary") };
    default:
      throw new ModelResponseValidationError(`Unknown action type: ${type}.`);
  }
}

export function parseModelDecision(value: unknown): ModelDecision {
  let decoded = value;
  if (typeof value === "string") {
    decoded = decodeJson(value);
  }

  const response = record(decoded, "model output");
  const intent = optionalString(response.intent, "intent");
  const decision: ModelDecision = { action: parseAction(normalizeAction(response)) };
  if (intent !== undefined) decision.intent = intent;
  return decision;
}

function tokenCount(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ModelResponseValidationError(`${location} must be a non-negative integer.`);
  }
  return value;
}

export function parseProviderUsage(value: unknown): ModelUsage {
  if (value === undefined) return { source: "unavailable" };

  const usage = record(value, "usage");
  return {
    source: "provider",
    inputTokens: tokenCount(usage.inputTokens, "usage.inputTokens"),
    outputTokens: tokenCount(usage.outputTokens, "usage.outputTokens"),
    totalTokens: tokenCount(usage.totalTokens, "usage.totalTokens"),
  };
}
