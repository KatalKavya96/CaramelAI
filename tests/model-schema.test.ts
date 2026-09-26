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
});
