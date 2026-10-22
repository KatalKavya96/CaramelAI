import type { AgentEvent } from "../../src/lib/contract";

let sequence = 0;
const at = (second: number) => new Date(Date.UTC(2026, 9, 22, 10, 0, second)).toISOString();
function event<T extends AgentEvent["type"]>(type: T, second: number, payload: Extract<AgentEvent, { type: T }>["payload"]): AgentEvent {
  sequence += 1;
  return { schemaVersion: 1, sequence, timestamp: at(second), type, payload } as AgentEvent;
}

/** A recorded run that fixes a bug, runs the tests and finishes verified. Shapes match events.jsonl. */
export const VERIFIED_RUN: AgentEvent[] = [
  event("run_started", 0, { runId: "run_a", task: "Fix flaky date parser", sourceRepo: "https://github.com/acme/api", workspacePath: "/w/run_a", budgets: { maxSteps: 80, maxMinutes: 20, maxModelCalls: 50 } }),
  event("model_decision", 2, { action: { type: "search", query: "parseDate" } } as never),
  event("step_started", 2, { step: 1, action: { type: "search", query: "parseDate" }, intent: "Find the parser" }),
  event("tool_result", 3, { action: "search", workspaceChanged: false, result: { ok: true, matches: 3 } }),
  event("model_decision", 5, { action: { type: "read_file", path: "src/date.ts" } } as never),
  event("step_started", 5, { step: 2, action: { type: "read_file", path: "src/date.ts" } }),
  event("tool_result", 5, { action: "read_file", workspaceChanged: false, result: { ok: true } }),
  event("model_decision", 8, { action: { type: "replace_text", path: "src/date.ts", search: "a", replacement: "b" } } as never),
  event("step_started", 8, { step: 3, action: { type: "replace_text", path: "src/date.ts", search: "a", replacement: "b" }, intent: "Use UTC" }),
  event("tool_result", 8, { action: "replace_text", workspaceChanged: true, result: { ok: true } }),
  event("model_error", 10, { kind: "rate_limited", message: "429 from provider", attempts: 1 } as never),
  event("model_decision", 12, { action: { type: "run_command", command: "bun test", purpose: "verification" } } as never),
  event("step_started", 12, { step: 4, action: { type: "run_command", command: "bun test", purpose: "verification" } as never }),
  event("tool_result", 20, { action: "run_command", workspaceChanged: false, result: { ok: true, exitCode: 0, durationMs: 7400, stdout: { preview: "12 pass\n0 fail", previewTruncated: false }, stderr: { preview: "", previewTruncated: false } } }),
  event("tool_result", 21, { action: "finish", workspaceChanged: false, error: "Run the final checks first." }),
  event("run_finished", 25, { status: "verified", terminationReason: "Final checks passed.", changedFiles: ["src/date.ts"], successfulFinalState: true }),
];

export const SAMPLE_PATCH = `diff --git a/src/date.ts b/src/date.ts
index 1111111..2222222 100644
--- a/src/date.ts
+++ b/src/date.ts
@@ -1,4 +1,4 @@
 export function parseDate(input: string) {
-  return new Date(input);
+  return new Date(\`\${input}T00:00:00Z\`);
 }
 
diff --git a/test/date.test.ts b/test/date.test.ts
new file mode 100644
--- /dev/null
+++ b/test/date.test.ts
@@ -0,0 +1,2 @@
+import { parseDate } from "../src/date";
+test("utc", () => expect(parseDate("2026-01-01").getUTCDate()).toBe(1));
`;
