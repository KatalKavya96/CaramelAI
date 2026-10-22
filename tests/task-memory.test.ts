import { describe, expect, test } from "bun:test";
import { RepositoryReadCache, TaskMemory } from "../src/memory";
import type { FileReadResult, RepositoryToolResult } from "../src/tools";

describe("TaskMemory", () => {
  test("keeps requests bounded while preserving task, failures, and action-result pairs", () => {
    const memory = new TaskMemory("system", "Never lose this task", { manifest: "package.json" }, {
      maxContextChars: 1_600,
      reserveResponseChars: 400,
      maxRecentPairs: 2,
      maxEntryChars: 300,
    });
    memory.recordFailure({
      sequence: 1, kind: "test", hypothesis: "wrong operator", action: "run_command",
      detail: "expected five but got six", codeFingerprint: "abc", countsAgainstRepairLimit: true,
    });
    for (let index = 0; index < 8; index += 1) {
      memory.recordDecision({ intent: `inspect ${index}`, action: { type: "list_files", path: `src/${index}` } });
      memory.recordObservation({ type: "list_files", path: `src/${index}` }, { entries: ["x".repeat(500)] });
    }
    const request = memory.request();
    const chars = request.messages.reduce((total, message) => total + message.content.length, 0);
    expect(chars).toBeLessThanOrEqual(1_200);
    expect(request.messages[1]?.content).toContain("Never lose this task");
    expect(request.messages[1]?.content).toContain("expected five but got six");
    const recentRoles = request.messages.slice(2).map(({ role }) => role);
    expect(recentRoles.length).toBeGreaterThanOrEqual(2);
    expect(recentRoles.every((role, index) => role === (index % 2 === 0 ? "assistant" : "user"))).toBeTrue();
    expect(memory.snapshot().compactions).toBeGreaterThan(0);
  });

  test("labels observations as untrusted tool output", () => {
    const memory = new TaskMemory("system", "task", {});
    memory.recordDecision({ action: { type: "list_files" } });
    memory.recordObservation({ type: "list_files" }, { ok: true, value: { entries: [] } });
    expect(memory.request().messages.at(-1)?.content).toContain("untrusted tool output");
  });

  test("formats invalid-response feedback as a complete assistant-user pair", () => {
    const memory = new TaskMemory("system", "task", {});
    memory.recordInvalidResponse("missing action");
    const messages = memory.request().messages;
    expect(messages.map(({ role }) => role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages.at(-1)?.content).toContain("missing action");
  });


  test("preserves exact focused read snippets for follow-up text replacement", () => {
    const memory = new TaskMemory("system", "task", {}, {
      maxContextChars: 8_000,
      reserveResponseChars: 1_000,
      maxEntryChars: 500,
    });
    const exactSnippet = "function target() {\n  return 'exact replacement context';\n}\n";

    memory.recordDecision({ action: { type: "read_file", path: "src/focused.ts", startLine: 20, endLine: 24 } });
    memory.recordObservation(
      { type: "read_file", path: "src/focused.ts", startLine: 20, endLine: 24 },
      {
        ok: true,
        value: {
          path: "src/focused.ts",
          content: exactSnippet,
          startLine: 20,
          endLine: 24,
          totalLines: 40,
          truncated: false,
        },
      },
    );

    const messages = memory.request().messages;
    const observation = messages.at(-1)?.content ?? "";
    expect(observation).toContain("exact replacement context");
    expect(observation).toContain('"exact":true');
  });

  test("compacts large read observations before keeping them in context", () => {
    const memory = new TaskMemory("system", "task", {}, {
      maxContextChars: 4_000,
      reserveResponseChars: 500,
      maxEntryChars: 1_200,
    });
    memory.recordDecision({ action: { type: "read_file", path: "src/big.ts" } });
    memory.recordObservation(
      { type: "read_file", path: "src/big.ts" },
      {
        ok: true,
        value: {
          path: "src/big.ts",
          content: "x".repeat(5_000),
          startLine: 1,
          endLine: 300,
          totalLines: 300,
          truncated: false,
        },
      },
    );

    const serialized = JSON.stringify(memory.request());
    expect(serialized).toContain("contentChars");
    expect(serialized).not.toContain("x".repeat(2_000));
  });
});

describe("TaskMemory context budget", () => {
  function longRun(memory: TaskMemory, steps: number): void {
    for (let index = 0; index < steps; index += 1) {
      memory.recordDecision({ intent: `hypothesis ${index} `.repeat(8), action: { type: "read_file", path: `src/file-${index}.ts` } });
      memory.recordObservation(
        { type: "read_file", path: `src/file-${index}.ts` },
        { ok: true, value: { path: `src/file-${index}.ts`, content: `marker-${index}\n${"x".repeat(2_000)}` } },
      );
    }
  }

  test("always shows the model the result of its latest action in long runs", () => {
    const memory = new TaskMemory("system", "task", {}, { maxContextChars: 8_000, reserveResponseChars: 1_000 });
    longRun(memory, 60);
    const request = memory.request();
    const chars = request.messages.reduce((total, message) => total + message.content.length, 0);
    expect(chars).toBeLessThanOrEqual(7_000);
    expect(request.messages.length).toBeGreaterThan(2);
    expect(request.messages.at(-1)?.content).toContain("marker-59");
  });

  test("drops the oldest summary entries first and keeps the summary valid JSON", () => {
    const memory = new TaskMemory("system", "task", {}, { maxContextChars: 8_000, reserveResponseChars: 1_000 });
    longRun(memory, 60);
    const summary = memory.request().messages[1]?.content ?? "";
    expect(() => JSON.parse(summary)).not.toThrow();
    expect(summary).toContain("src/file-59.ts");
    expect(summary).not.toContain("src/file-0.ts");
  });

  test("keeps a huge task and a huge edit inside the budget without losing the latest observation", () => {
    const memory = new TaskMemory("system", `start ${"t".repeat(100_000)} end-of-task`, {}, {
      maxContextChars: 8_000,
      reserveResponseChars: 1_000,
    });
    memory.recordDecision({ action: { type: "replace_file", path: "src/big.ts", content: "y".repeat(50_000) } });
    memory.recordObservation({ type: "replace_file", path: "src/big.ts", content: "y".repeat(50_000) }, { ok: true, value: { changedFiles: ["src/big.ts"] } });
    const request = memory.request();
    const chars = request.messages.reduce((total, message) => total + message.content.length, 0);
    expect(chars).toBeLessThanOrEqual(7_000);
    expect(request.messages[1]?.content).toContain("start");
    expect(request.messages[1]?.content).toContain("end-of-task");
    expect(request.messages.at(-1)?.content).toContain("src/big.ts");
  });
});

describe("RepositoryReadCache", () => {
  test("keys ranges and refuses a stale workspace fingerprint", () => {
    const cache = new RepositoryReadCache();
    const result: RepositoryToolResult<FileReadResult> = {
      ok: true,
      value: { path: "src/a.ts", content: "old", startLine: 1, endLine: 1, totalLines: 1, truncated: false },
    };
    cache.set("src/a.ts", 1, 1, "before", result);
    expect(cache.get("src/a.ts", 1, 1, "before")).toEqual(result);
    expect(cache.get("src/a.ts", 1, 1, "after")).toBeUndefined();
    expect(cache.get("src/a.ts", 2, 2, "before")).toBeUndefined();
  });
});
