import { render, screen } from "@testing-library/react";
import { applyThread } from "../src/data/apply";
import { ApplyNotice, repoError, sandboxLabel } from "../src/domain";
import type { ApplyResult } from "../src/lib/contract";
import { repoLabel } from "../src/lib/format";

describe("repoError", () => {
  const hosted = ["git"] as const;
  const local = ["local", "git"] as const;
  const git = (repoUrl: string) => ({ repoKind: "git" as const, repoUrl, localPath: "" });
  const folder = (localPath: string) => ({ repoKind: "local" as const, repoUrl: "", localPath });

  it("keeps the hosted server to GitHub https URLs", () => {
    expect(repoError(git("https://github.com/acme/api"), [...hosted])).toBeNull();
    expect(repoError(git("https://gitlab.com/acme/api"), [...hosted])).toMatch(/GitHub/);
    expect(repoError(folder("/Users/k/code"), [...hosted])).toMatch(/cannot run/);
  });

  it("lets the desktop app use absolute folders and other git hosts", () => {
    expect(repoError(folder("/Users/k/code/api"), [...local])).toBeNull();
    expect(repoError(folder("code/api"), [...local])).toMatch(/full path/);
    expect(repoError(folder(""), [...local])).toMatch(/Choose a folder/);
    expect(repoError(git("https://gitlab.com/acme/api"), [...local])).toBeNull();
  });
});

describe("labels", () => {
  it("names the sandbox and network", () => {
    expect(sandboxLabel("seatbelt", "none")).toBe("macOS sandbox · no network");
    expect(sandboxLabel("bubblewrap", "full")).toBe("Linux sandbox · network on");
    expect(sandboxLabel("docker", "none")).toBe("Docker sandbox · no network");
  });
  it("shows a local folder by its name", () => {
    expect(repoLabel("/Users/k/code/caramel/")).toBe("caramel");
  });
});

describe("applyThread", () => {
  const ok = (files: string[]): ApplyResult => ({ applied: true, files });
  const fail = (reason: "conflicts" | "already_applied" | "no_changes", conflicts: string[] = []): ApplyResult => ({ applied: false, reason, conflicts, message: reason });

  it("applies turns oldest first and skips ones already in the folder", async () => {
    const calls: string[] = [];
    const results: Record<string, ApplyResult> = { a: fail("already_applied"), b: ok(["src/x.ts"]), c: ok(["src/x.ts", "src/y.ts"]) };
    const outcome = await applyThread({ applyRun: async (id) => (calls.push(id), results[id] as ApplyResult) }, ["a", "b", "c"]);
    expect(calls).toEqual(["a", "b", "c"]);
    expect(outcome).toEqual({ ok: true, files: ["src/x.ts", "src/y.ts"], skipped: 1 });
  });

  it("stops at the first turn that conflicts and names it", async () => {
    const calls: string[] = [];
    const results: Record<string, ApplyResult> = { a: ok(["a.ts"]), b: fail("conflicts", ["b.ts"]), c: ok(["c.ts"]) };
    const outcome = await applyThread({ applyRun: async (id) => (calls.push(id), results[id] as ApplyResult) }, ["a", "b", "c"]);
    expect(calls).toEqual(["a", "b"]);
    expect(outcome).toMatchObject({ ok: false, failedRunId: "b", turn: 2 });
  });
});

describe("ApplyNotice", () => {
  it("lists conflicting files and leaves the folder untouched", () => {
    render(<ApplyNotice folder="/Users/k/code/api" outcome={{ ok: false, turn: 2, turns: 2, result: { applied: false, reason: "conflicts", conflicts: ["src/date.ts"], message: "" } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Turn 2 could not be applied. Nothing in api was changed by it.");
    expect(screen.getByText("src/date.ts")).toBeInTheDocument();
  });
  it("counts applied files", () => {
    render(<ApplyNotice folder="/Users/k/code/api" outcome={{ ok: true, files: ["a.ts", "b.ts"], skipped: 0 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Applied 2 files to api.");
  });
});
