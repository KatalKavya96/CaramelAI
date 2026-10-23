import { ApiError, apiErrorMessage, createApiClient } from "../src/data/api";
import { parseUnifiedDiff } from "../src/lib/diff";
import { dateGroup, describeAction, formatClock, formatDuration, repoLabel } from "../src/lib/format";
import { findings, formatRate, formatUsd, parseScorecard } from "../src/lib/scorecard";
import { isActive, isTerminal, statusCopy } from "../src/lib/status";
import { SCORECARD } from "./fixtures/scorecard";
import { SAMPLE_PATCH } from "./fixtures/events";

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(SAMPLE_PATCH);
  it("splits files and counts lines", () => {
    expect(files.map((file) => [file.path, file.change, file.additions, file.deletions])).toEqual([
      ["src/date.ts", "modified", 1, 1],
      ["test/date.test.ts", "added", 2, 0],
    ]);
  });
  it("numbers old and new lines from the hunk header", () => {
    const lines = files[0]?.lines ?? [];
    expect(lines.find((line) => line.kind === "del")).toMatchObject({ oldNumber: 2 });
    expect(lines.find((line) => line.kind === "add")).toMatchObject({ newNumber: 2 });
  });
});

describe("status", () => {
  it("has copy for every status and splits active from terminal", () => {
    const all = ["queued", "preparing", "running", "verified", "partial", "blocked", "budget_exhausted", "failed", "cancelled"] as const;
    for (const status of all) {
      expect(statusCopy(status).label).not.toBe("");
      expect(isActive(status)).toBe(!isTerminal(status));
    }
    expect(all.filter(isActive)).toEqual(["queued", "preparing", "running"]);
  });
});

describe("format", () => {
  it("formats durations and clocks", () => {
    expect(formatDuration(7400)).toBe("7s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatClock(65_000)).toBe("01:05");
  });
  it("labels repositories and actions", () => {
    expect(repoLabel("https://github.com/acme/api.git")).toBe("acme/api");
    expect(describeAction({ type: "read_file", path: "a.ts", startLine: 3, endLine: 9 })).toBe("a.ts:3-9");
  });
  it("groups dates", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(dateGroup("2026-10-22T08:00:00Z", now)).toBe("Today");
    expect(dateGroup("2026-10-18T08:00:00Z", now)).toBe("Previous 7 days");
    expect(dateGroup("2026-09-01T08:00:00Z", now)).toBe("Older");
  });
});

describe("api client", () => {
  it("turns error bodies into ApiError with a readable message", async () => {
    const api = createApiClient({ fetcher: async () => new Response(JSON.stringify({ error: "run_limit" }), { status: 429 }) });
    await expect(api.listRuns()).rejects.toMatchObject({ status: 429, code: "run_limit" });
    expect(apiErrorMessage(429, "run_limit")).toMatch(/already have a run/);
  });
  it("maps a network failure to network_error", async () => {
    const api = createApiClient({ fetcher: async () => { throw new TypeError("fetch failed"); } });
    const error = await api.me().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network_error");
  });
  it("sends writes as same-origin JSON, so the session cookie goes along", async () => {
    let seen: RequestInit | undefined;
    const api = createApiClient({ fetcher: async (_url, init) => { seen = init; return new Response(JSON.stringify({ id: "run_b" }), { status: 201 }); } });
    await api.startRun({ parentRunId: "run_a", task: "Also add a test" });
    expect(seen?.method).toBe("POST");
    expect(seen?.credentials).toBe("same-origin");
    expect(new Headers(seen?.headers).get("content-type")).toMatch(/json/);
  });
});

describe("scorecards", () => {
  it("reads a scorecard and explains a wrong file", () => {
    expect(parseScorecard(JSON.stringify(SCORECARD)).models).toHaveLength(2);
    expect(() => parseScorecard("not json")).toThrow(/not JSON/);
    expect(() => parseScorecard(JSON.stringify({ runs: [] }))).toThrow(/not a benchmark scorecard/);
    expect(() => parseScorecard(JSON.stringify({ ...SCORECARD, schemaVersion: 2 }))).toThrow(/format 2/);
  });
  it("puts false successes first and ignores skipped runs", () => {
    const flagged = findings(SCORECARD.runs);
    expect(flagged.map(({ run, finding }) => [run.model, run.taskId, finding])).toEqual([["x-ai/grok-4", "py-not-a-bug", "false_success"]]);
  });
  it("formats rates and money", () => {
    expect([formatRate(null), formatRate(0.666), formatUsd(0), formatUsd(0.004), formatUsd(1.5)]).toEqual(["–", "67%", "$0", "$0.0040", "$1.50"]);
  });
});

describe("local folder paths", () => {
  it("expands ~ and normalizes the way the server does", async () => {
    const { repoError, resolveLocalPath } = await import("../src/domain/run-options");
    expect(resolveLocalPath(" ~/caramel-try/ ", "/Users/kavya")).toBe("/Users/kavya/caramel-try");
    expect(resolveLocalPath("~", "/Users/kavya")).toBe("/Users/kavya");
    expect(resolveLocalPath("/Users/kavya/code/../caramel-try/./", null)).toBe("/Users/kavya/caramel-try");
    expect(resolveLocalPath("~/x", null)).toBeNull();
    expect(resolveLocalPath("~other/x", "/Users/kavya")).toBeNull();
    expect(resolveLocalPath("caramel-try", "/Users/kavya")).toBeNull();
    expect(repoError({ repoKind: "local", repoUrl: "", localPath: "~/caramel-try" }, ["local"], "/Users/kavya")).toBeNull();
    expect(repoError({ repoKind: "local", repoUrl: "", localPath: "caramel-try" }, ["local"], "/Users/kavya")).toMatch(/starting with \/ or ~\//);
  });
});
