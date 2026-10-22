import { z } from "zod";
import type { ModelAction, ModelDecision, ModelUsage } from "./types";

export class ModelResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelResponseValidationError";
  }
}

// These zod schemas are the single source of truth: the parser validates with them and the
// provider JSON Schema is generated from them, so the two can never drift apart.
const nonEmptyString = (location: string) => {
  const message = `${location} must be a non-empty string.`;
  return z.string({ error: message }).refine((value) => value.trim() !== "", { message });
};
const anyString = (location: string) => z.string({ error: `${location} must be a string.` });
const positiveInteger = (location: string) => {
  const error = `${location} must be a positive integer.`;
  return z.number({ error }).int({ error }).positive({ error });
};

export const ListFilesActionSchema = z.object({
  type: z.literal("list_files"),
  path: nonEmptyString("action.path").optional(),
  maxDepth: positiveInteger("action.maxDepth").optional(),
});

export const SearchActionSchema = z.object({
  type: z.literal("search"),
  query: nonEmptyString("action.query"),
  path: nonEmptyString("action.path").optional(),
  maxResults: positiveInteger("action.maxResults").optional(),
});

export const ReadFileActionSchema = z.object({
  type: z.literal("read_file"),
  path: nonEmptyString("action.path"),
  startLine: positiveInteger("action.startLine").optional(),
  endLine: positiveInteger("action.endLine").optional(),
}).refine(
  (data) => data.startLine === undefined || data.endLine === undefined || data.endLine >= data.startLine,
  { message: "action.endLine must be greater than or equal to action.startLine." },
);

export const ApplyPatchActionSchema = z.object({
  type: z.literal("apply_patch"),
  patch: nonEmptyString("action.patch"),
});

export const ReplaceTextActionSchema = z.object({
  type: z.literal("replace_text"),
  path: nonEmptyString("action.path"),
  search: nonEmptyString("action.search"),
  replacement: anyString("action.replacement"),
});

export const ReplaceFileActionSchema = z.object({
  type: z.literal("replace_file"),
  path: nonEmptyString("action.path"),
  content: anyString("action.content"),
});

export const CreateCheckpointActionSchema = z.object({
  type: z.literal("create_checkpoint"),
  label: nonEmptyString("action.label"),
});

export const RestoreCheckpointActionSchema = z.object({
  type: z.literal("restore_checkpoint"),
  checkpointId: nonEmptyString("action.checkpointId"),
});

export const RunCommandActionSchema = z.object({
  type: z.literal("run_command"),
  command: nonEmptyString("action.command"),
  purpose: z.enum(["setup", "agent", "verification"], {
    error: "action.purpose must be setup, agent, or verification.",
  }).optional(),
  cwd: nonEmptyString("action.cwd").optional(),
  timeoutMs: positiveInteger("action.timeoutMs").optional(),
});

export const InspectDiffActionSchema = z.object({
  type: z.literal("inspect_diff"),
});

export const FinishActionSchema = z.object({
  type: z.literal("finish"),
  summary: nonEmptyString("action.summary"),
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
  intent: nonEmptyString("intent").optional(),
  action: ModelActionSchema,
});

const ACTION_TYPES: ReadonlySet<string> = new Set(ModelActionSchema.options.map((option) => option.shape.type.value));

// Compile-time guard: ModelAction in types.ts and the schema must name the same action types.
type SchemaActionType = z.infer<typeof ModelActionSchema>["type"];
const actionTypesMatch: [ModelAction["type"]] extends [SchemaActionType]
  ? [SchemaActionType] extends [ModelAction["type"]] ? true : never
  : never = true;
void actionTypesMatch;

/**
 * JSON Schema for providers that support structured output, generated from ModelDecisionSchema.
 * Refinements (non-blank strings, line order) cannot be expressed here, so the parser still runs.
 */
export function modelDecisionJsonSchema(): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(ModelDecisionSchema, { unrepresentable: "any" });
  // Discriminated by `type`, so oneOf and anyOf accept the same objects; anyOf has wider provider support.
  return JSON.parse(JSON.stringify(schema).replaceAll('"oneOf":', '"anyOf":')) as Record<string, unknown>;
}

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

export function parseModelDecision(value: unknown): ModelDecision {
  const decoded = typeof value === "string" ? decodeJson(value) : value;
  const response = record(decoded, "model output");
  const action = record(normalizeAction(response), "action");
  if (typeof action.type !== "string" || !ACTION_TYPES.has(action.type)) {
    throw new ModelResponseValidationError(`Unknown action type: ${String(action.type)}.`);
  }
  const parsed = ModelDecisionSchema.safeParse({ intent: response.intent, action });
  if (!parsed.success) {
    throw new ModelResponseValidationError(parsed.error.issues[0]?.message ?? "Invalid model decision.");
  }
  // Zod types absent optionals as `?: T | undefined`; parsed JSON never holds explicit undefined.
  const decision: ModelDecision = { action: parsed.data.action as ModelAction };
  if (parsed.data.intent !== undefined) decision.intent = parsed.data.intent;
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
    ...(usage.cachedInputTokens === undefined || usage.cachedInputTokens === null
      ? {}
      : { cachedInputTokens: tokenCount(usage.cachedInputTokens, "usage.cachedInputTokens") }),
    ...(usage.costUsd === undefined || usage.costUsd === null ? {} : { costUsd: dollars(usage.costUsd, "usage.costUsd") }),
  };
}

function dollars(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative number.`);
  }
  return value;
}
