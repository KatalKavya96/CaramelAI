import { describe, expect, test } from "bun:test";
import { ProgressTracker } from "../src/agent/progress";

const edit = (content: string) => ({ type: "replace_file" as const, path: "a.ts", content });
const ok = { ok: true };

describe("ProgressTracker", () => {
  test("flags an immediate repeat on unchanged code", () => {
    const tracker = new ProgressTracker();
    expect(tracker.observe({ type: "inspect_diff" }, ok, "s0")).toBe(1);
    expect(tracker.observe({ type: "inspect_diff" }, ok, "s0")).toBe(2);
  });

  test("flags an edit that is reverted and re-applied (A,B,A,B)", () => {
    const tracker = new ProgressTracker();
    expect(tracker.observe(edit("new"), ok, "s1")).toBe(1);
    expect(tracker.observe(edit("old"), ok, "s0")).toBe(1);
    expect(tracker.observe(edit("new"), ok, "s1")).toBe(2);
    expect(tracker.observe(edit("old"), ok, "s0")).toBe(2);
  });

  test("does not flag the same action once the code has changed", () => {
    const tracker = new ProgressTracker();
    const tests = { type: "run_command" as const, command: "bun test" };
    expect(tracker.observe(tests, { status: "completed", exitCode: 1 }, "s0")).toBe(1);
    expect(tracker.observe(tests, { status: "completed", exitCode: 0 }, "s1")).toBe(1);
  });

  test("forgets repeats older than the window", () => {
    const tracker = new ProgressTracker();
    tracker.observe({ type: "inspect_diff" }, ok, "s0");
    for (let index = 0; index < 6; index += 1) tracker.observe({ type: "read_file", path: `f${index}` }, ok, "s0");
    expect(tracker.observe({ type: "inspect_diff" }, ok, "s0")).toBe(1);
  });
});
