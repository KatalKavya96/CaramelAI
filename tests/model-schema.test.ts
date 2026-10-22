import { describe, expect, test } from "bun:test";
import {
  ModelResponseValidationError,
  parseModelDecision,
  parseProviderUsage,
  type ModelAction,
} from "../src/model";

describe("model response schema", () => {
  const validActions: readonly [unknown, ModelAction["type"]][] = [
    [{ action: { type: "list_files", path: "src", maxDepth: 2 } }, "list_files"],
    [{ action: { type: "search", query: "refreshToken", maxResults: 20 } }, "search"],
    [{ action: { type: "read_file", path: "src/a.ts", startLine: 1, endLine: 10 } }, "read_file"],
    [{ action: { type: "apply_patch", patch: "*** Begin Patch" } }, "apply_patch"],
    [{ action: { type: "replace_text", path: "src/a.ts", search: "old", replacement: "" } }, "replace_text"],
    [{ action: { type: "replace_file", path: "src/a.ts", content: "" } }, "replace_file"],
    [{ action: { type: "create_checkpoint", label: "before alternate fix" } }, "create_checkpoint"],
    [{ action: { type: "restore_checkpoint", checkpointId: "latest" } }, "restore_checkpoint"],
    [
      {
        action: {
          type: "run_command",
          command: "bun test",
          purpose: "verification",
          timeoutMs: 30_000,
        },
      },
      "run_command",
    ],
    [{ action: { type: "inspect_diff" } }, "inspect_diff"],
    [{ action: { type: "finish", summary: "Fixed and verified." } }, "finish"],
  ];

  test.each(validActions)("accepts a valid structured action", (input, expectedType) => {
    expect(parseModelDecision(input).action.type).toBe(expectedType);
  });

  test("parses JSON strings and a single JSON markdown fence", () => {
    expect(parseModelDecision('{"intent":"inspect","action":{"type":"list_files"}}')).toEqual({
      intent: "inspect",
      action: { type: "list_files" },
    });
    expect(parseModelDecision("```json\n{\"action\":{\"type\":\"inspect_diff\"}}\n```")).toEqual({
      action: { type: "inspect_diff" },
    });
    // Fenced JSON embedded in prose is now extracted — {} is valid JSON but missing 'action'
    expect(() => parseModelDecision("before ```json\n{}\n``` after")).toThrow("action");
    // Truly unparseable text still throws
    expect(() => parseModelDecision("this is just plain text with no JSON at all")).toThrow("valid JSON");
  });

  test("normalizes bounded provider variants before validation", () => {
    expect(parseModelDecision({ action: "list_files", path: "src", maxDepth: 2 })).toEqual({
      action: { type: "list_files", path: "src", maxDepth: 2 },
    });
    expect(parseModelDecision({ action: '{"type":"read_file","path":"README.md"}' })).toEqual({
      action: { type: "read_file", path: "README.md" },
    });
    expect(parseModelDecision({ action: { type: "command", cmd: "npm test", purpose: "verification" } })).toEqual({
      action: { type: "run_command", command: "npm test", purpose: "verification" },
    });
  });

  test("rejects unknown actions and invalid arguments", () => {
    expect(() => parseModelDecision({ intent: "missing action" })).toThrow("action must be an object");
    expect(() => parseModelDecision({ action: { type: "delete_repository" } })).toThrow(
      "Unknown action type",
    );
    expect(() =>
      parseModelDecision({ action: { type: "read_file", path: "a", startLine: 10, endLine: 2 } }),
    ).toThrow("greater than or equal");
    expect(() => parseModelDecision({ action: { type: "search", query: "" } })).toThrow(
      ModelResponseValidationError,
    );
    expect(() =>
      parseModelDecision({ action: { type: "replace_file", path: "src/a.ts", content: 42 } }),
    ).toThrow("action.content must be a string");
    expect(() =>
      parseModelDecision({ action: { type: "replace_text", path: "src/a.ts", search: "", replacement: "x" } }),
    ).toThrow("action.search must be a non-empty string");
    expect(() =>
      parseModelDecision({ action: { type: "run_command", command: "test", purpose: "claim" } }),
    ).toThrow("setup, agent, or verification");
  });

  test("distinguishes provider usage from unavailable usage", () => {
    expect(parseProviderUsage(undefined)).toEqual({ source: "unavailable" });
    expect(parseProviderUsage({ inputTokens: 10, outputTokens: 4, totalTokens: 14 })).toEqual({
      source: "provider",
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    });
  });

  test("rejects malformed usage", () => {
    expect(() =>
      parseProviderUsage({ inputTokens: 1, outputTokens: -1, totalTokens: 0 }),
    ).toThrow("non-negative integer");
  });

  test("validates model decisions with Zod schema", () => {
    const { ModelDecisionSchema } = require("../src/model");
    const valid = ModelDecisionSchema.safeParse({
      intent: "read file",
      action: { type: "read_file", path: "src/main.ts", startLine: 1, endLine: 50 },
    });
    expect(valid.success).toBe(true);

    const invalid = ModelDecisionSchema.safeParse({
      action: { type: "unknown_type" },
    });
    expect(invalid.success).toBe(false);
  });

  test("validates plan mode responses with Zod schema", () => {
    const { PlanResponseSchema, parsePlanResponse } = require("../src/agent");
    const validPlan = {
      summary: "Refactor database migrations to use transactions.",
      questions: [
        {
          question: "Which migration runner should be used?",
          options: ["Knex.js (recommended)", "Prisma", "Raw SQL"],
          defaultIndex: 0,
          allowCustom: true,
        },
      ],
    };
    const parsed = PlanResponseSchema.safeParse(validPlan);
    expect(parsed.success).toBe(true);

    const fromJson = parsePlanResponse(JSON.stringify(validPlan));
    expect(fromJson.summary).toBe(validPlan.summary);
    expect(fromJson.questions.length).toBe(1);
    expect(fromJson.questions[0].options[0]).toBe("Knex.js (recommended)");
  });
});

describe("model decision JSON schema", () => {
  const { MODEL_DECISION_SCHEMA, ModelActionSchema } = require("../src/model");
  const variants = (MODEL_DECISION_SCHEMA as any).properties.action.anyOf as any[];

  test("is generated from the zod schema, so every action type is offered to the provider", () => {
    const zodTypes = ModelActionSchema.options.map((option: any) => option.shape.type.value).sort();
    const jsonTypes = variants.map((variant) => variant.properties.type.const).sort();
    expect(jsonTypes).toEqual(zodTypes);
    expect(JSON.stringify(MODEL_DECISION_SCHEMA)).not.toContain("oneOf");
  });

  test("keeps required fields and positive integers in sync with the parser", () => {
    const read = variants.find((variant) => variant.properties.type.const === "read_file");
    expect(read.required).toEqual(["type", "path"]);
    expect(read.properties.startLine.type).toBe("integer");
    const command = variants.find((variant) => variant.properties.type.const === "run_command");
    expect(command.properties.purpose.enum).toEqual(["setup", "agent", "verification"]);
  });

  test("rejects whitespace-only strings in the zod schema itself, not only in a hand parser", () => {
    const { ModelDecisionSchema } = require("../src/model");
    expect(ModelDecisionSchema.safeParse({ action: { type: "finish", summary: "   " } }).success).toBe(false);
    expect(() => parseModelDecision({ action: { type: "finish", summary: "  " } })).toThrow(
      "action.summary must be a non-empty string",
    );
    expect(() => parseModelDecision({ action: { type: "read_file", path: "a", startLine: 0 } })).toThrow(
      "action.startLine must be a positive integer",
    );
  });
});

describe("usage metering", () => {
  test("adds up reported cost and counts calls that did not report one", async () => {
    const { emptyUsageSummary, recordUsage } = await import("../src/agent/types");
    const summary = emptyUsageSummary();
    recordUsage(summary, { source: "provider", inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 60, costUsd: 0.001 });
    recordUsage(summary, { source: "provider", inputTokens: 100, outputTokens: 10, totalTokens: 110, costUsd: 0.002 });
    recordUsage(summary, { source: "provider", inputTokens: 5, outputTokens: 5, totalTokens: 10 });
    recordUsage(summary, { source: "unavailable" });
    expect(summary).toMatchObject({ providerTotalTokens: 230, cachedInputTokens: 60, costUnknownCalls: 1, unavailableCalls: 1 });
    expect(summary.providerCostUsd).toBeCloseTo(0.003, 10);
  });

  test("rejects a negative or non-numeric cost as bad accounting", () => {
    expect(() => parseProviderUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: -1 })).toThrow();
    expect(parseProviderUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: null })).toEqual({
      source: "provider", inputTokens: 1, outputTokens: 1, totalTokens: 2,
    });
  });
});
