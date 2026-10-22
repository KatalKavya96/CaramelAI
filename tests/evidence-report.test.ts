import { describe, expect, test } from "bun:test";
import { createAgentEventRenderer, renderEvidenceReport, type AgentRunResult } from "../src/agent";

function result(): AgentRunResult {
  return {
    runId: "run", status: "partial", terminationReason: "Missing final evidence.", summary: "Changed code but could not verify.", task: "Fix it",
    sourceRepo: "/repo", workspacePath: "/run/workspace", resultPath: "/run/result.json", eventsPath: "/run/events.jsonl", patchPath: "/run/patch.diff", reportPath: "/run/report.md", changedFiles: ["src/a.ts"],
    verification: { commandsRun: 1, successfulFinalState: false, diffReviewedForFinalState: true, discoveredChecks: [], evidence: [{ id: "1", codeFingerprint: "old", command: "bun test", cwd: ".", status: "passed", exitCode: 0, durationMs: 10, timeoutMs: 1000, stdoutLogPath: "/out", stderrLogPath: "/err", testCounts: { passed: 1, failed: 0, skipped: 0, total: 1 }, baseline: false, trusted: true }], lastResult: null },
    recovery: { maxRepairAttempts: 4, repairAttempts: 1, failures: [{ sequence: 1, kind: "test", hypothesis: null, action: "run_command", detail: "failed", codeFingerprint: "final", countsAgainstRepairLimit: true }], checkpointsCreated: 0, checkpointsRestored: 0 },
    memory: { maxContextChars: 1000, reserveResponseChars: 100, largestRequestChars: 500, compactions: 0, recentPairs: 1, findings: 0, hypotheses: 0, failures: 1, edits: 1, checks: 1, readCacheHits: 0, readCacheMisses: 0 },
    metrics: { steps: 2, modelCalls: 3, commandsRun: 1, stagnationInterventions: 0, verificationReserveActivations: 0, durationMs: 50 },
    usage: { providerInputTokens: 0, providerOutputTokens: 0, providerTotalTokens: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedTotalTokens: 0, unavailableCalls: 3 },
  };
}

describe("evidence report", () => {
  test("shows stale evidence, missing gates, failure history, usage, and artifacts", () => {
    const report = renderEvidenceReport(result(), "final");
    expect(report).toContain("Status: **partial**");
    expect(report).toContain("Final-state verification: MISSING");
    expect(report).toContain("Stale evidence records: 1");
    expect(report).toContain("Recorded failures (including recovered attempts): 1");
    expect(report).toContain("Calls with unavailable usage: 3");
    expect(report).toContain("/run/patch.diff");
  });

  test("plain event rendering contains no ANSI sequences and includes concise intent", () => {
    const output: string[] = [];
    const render = createAgentEventRenderer((message) => output.push(message), { color: false });
    render({ schemaVersion: 1, sequence: 1, timestamp: "now", type: "model_decision", payload: { intent: "inspect math", action: { type: "read_file", path: "src/math.ts" } } });
    render({ schemaVersion: 1, sequence: 2, timestamp: "now", type: "run_finished", payload: { status: "partial", terminationReason: "budget", changedFiles: [], successfulFinalState: false } });
    expect(output.join("\n")).toContain("[001] ◆ MODEL → read_file");
    expect(output.join("\n")).toContain('\"intent\": \"inspect math\"');
    expect(output.join("\n")).toContain("[002] ■ RUN FINISHED: partial");
    expect(output.join("\n")).not.toContain("\u001b[");
  });

  test("terminal rendering compacts large read results", () => {
    const output: string[] = [];
    const render = createAgentEventRenderer((message) => output.push(message), { color: false });
    render({
      schemaVersion: 1,
      sequence: 1,
      timestamp: "now",
      type: "tool_result",
      payload: {
        action: "read_file",
        workspaceChanged: false,
        result: {
          ok: true,
          value: {
            path: "src/big.ts",
            content: "x".repeat(5_000),
            startLine: 1,
            endLine: 200,
            totalLines: 200,
            truncated: false,
          },
        },
      },
    });

    const rendered = output.join("\n");
    expect(rendered).toContain("contentChars");
    expect(rendered).toContain("[truncated");
    expect(rendered).not.toContain("x".repeat(2_000));
  });
});
