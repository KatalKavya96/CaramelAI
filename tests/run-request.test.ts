import { describe, expect, test } from "bun:test";
import { parseRunRequest, RunRequestError, SHARED_SERVER_POLICY, type RunRequestPolicy } from "../src/service";

const LOCAL_POLICY: RunRequestPolicy = { ...SHARED_SERVER_POLICY, allowLocalRepos: true };
const base = { task: "Fix add", provider: "openrouter", repo: { kind: "git", url: "https://github.com/katal/demo.git" } };

function issues(input: unknown, policy = SHARED_SERVER_POLICY): readonly string[] {
  try {
    parseRunRequest(input, policy);
    return [];
  } catch (error) {
    if (error instanceof RunRequestError) return error.issues;
    throw error;
  }
}

describe("RunRequest", () => {
  test("the desktop app expands ~ and normalizes a local path; a shared server never does", () => {
    const desktop = { ...LOCAL_POLICY, homeDir: "/Users/kavya" };
    const path = (input: string) => {
      const request = parseRunRequest({ ...base, repo: { kind: "local", path: input } }, desktop);
      return request.repo.kind === "local" ? request.repo.path : null;
    };
    expect(path("~/caramel-try/")).toBe("/Users/kavya/caramel-try");
    expect(path("/Users/kavya/code/../caramel-try/.")).toBe("/Users/kavya/caramel-try");
    expect(issues({ ...base, repo: { kind: "local", path: "~/x" } }, LOCAL_POLICY)).toEqual(["repo.path: use the folder's full path, starting with / or ~/."]);
    expect(issues({ ...base, repo: { kind: "local", path: "~root/x" } }, desktop).join()).toContain("absolute or start with ~/");
    expect(issues({ ...base, repo: { kind: "local", path: "~/x" } })).toEqual(["repo: this server accepts only git URLs, not local paths."]);
  });

  test("fills budget defaults and accepts a GitHub URL", () => {
    const request = parseRunRequest(base, SHARED_SERVER_POLICY);
    expect(request.budgets.maxSteps).toBe(120);
    // The 60-minute default is capped at this server's 30-minute ceiling.
    expect(request.budgets.maxMinutes).toBe(30);
    expect(request.planMode).toBeFalse();
  });

  test("a shared server never accepts a host path", () => {
    expect(issues({ ...base, repo: { kind: "local", path: "/etc" } })).toEqual([
      "repo: this server accepts only git URLs, not local paths.",
    ]);
    expect(parseRunRequest({ ...base, repo: { kind: "local", path: "/repo" } }, LOCAL_POLICY).repo.kind).toBe("local");
  });

  test("rejects other hosts, non-https URLs and embedded credentials", () => {
    expect(issues({ ...base, repo: { kind: "git", url: "https://evil.example/x.git" } })[0]).toContain("not allowed");
    expect(issues({ ...base, repo: { kind: "git", url: "http://github.com/a/b" } })[0]).toContain("https");
    expect(issues({ ...base, repo: { kind: "git", url: "https://user:token@github.com/a/b" } })[0]).toContain("credentials");
    expect(issues({ ...base, repo: { kind: "git", url: "https://github.com/a/b", ref: "--upload-pack=x" } })[0]).toContain("ref");
  });

  test("caps budgets at the server's ceilings and reports every problem at once", () => {
    const found = issues({ ...base, task: "", budgets: { maxMinutes: 600 } });
    expect(found.some((issue) => issue.startsWith("task:"))).toBeTrue();
    expect(issues({ ...base, budgets: { maxMinutes: 600, maxSteps: 500 } })).toEqual([
      "budgets.maxSteps: 500 exceeds this server's limit of 120.",
      "budgets.maxMinutes: 600 exceeds this server's limit of 30.",
    ]);
  });
});
