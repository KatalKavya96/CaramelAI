import { describe, expect, test } from "bun:test";
import { createEvidence, discoverChecks, isTrustedVerification, parseTestCounts, verificationStatus } from "../src/verification";
import type { RepositoryMetadata } from "../src/tools";
import type { CommandResult } from "../src/execution";

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  const output = (preview: string) => ({ preview, previewTruncated: false, logPath: `/tmp/${crypto.randomUUID()}.log`, logTruncated: false, capturedBytes: preview.length });
  return {
    commandId: "check-1", command: "bun test", purpose: "verification", cwd: ".", image: "test",
    status: "completed", exitCode: 0, durationMs: 12, timeoutMs: 1_000,
    stdout: output("4 pass\n1 skip\n0 fail\n"), stderr: output(""), ...overrides,
  };
}

describe("verification evidence", () => {
  test("parses test counts and ties evidence to the code fingerprint", () => {
    expect(parseTestCounts(result())).toEqual({ passed: 4, failed: 0, skipped: 1, total: 5 });
    expect(createEvidence({ result: result(), codeFingerprint: "abc", baseline: false })).toMatchObject({
      codeFingerprint: "abc", status: "passed", baseline: false, testCounts: { total: 5 },
    });
  });

  test("keeps failure, skipped, timeout, unknown, and zero-test outcomes distinct", () => {
    expect(verificationStatus(result({ exitCode: 1 }), null)).toBe("failed");
    expect(verificationStatus(result({ status: "timed_out", exitCode: null }), null)).toBe("timed_out");
    expect(verificationStatus(result({ status: "runner_error", exitCode: null }), null)).toBe("unknown");
    expect(verificationStatus(result(), { passed: 0, failed: 0, skipped: 2, total: 2 })).toBe("skipped");
    expect(verificationStatus(result(), { passed: 0, failed: 0, skipped: 0, total: 0 })).toBe("unknown");
  });

  test("discovers package script commands and marks aliases as defined by the manifest", () => {
    const metadata = { manifests: ["package.json", "bun.lock"], testConfigs: [] } as unknown as RepositoryMetadata;
    const checks = discoverChecks(metadata, { packageJson: { scripts: { test: "bun test ./test" } } });
    expect(checks).toContainEqual({ command: "bun test ./test", source: "package.json scripts.test", category: "test" });
    expect(checks).toContainEqual({ command: "bun run test", source: "package.json scripts.test", category: "test", definedBy: "package.json" });
    expect(checks.some((check) => check.command === "true")).toBeFalse();
  });

  test("discovers Cargo and Go checks", () => {
    const metadata = { manifests: ["Cargo.toml", "go.mod"], testConfigs: [] } as unknown as RepositoryMetadata;
    expect(discoverChecks(metadata).map((check) => check.command)).toEqual(["cargo test", "go test ./..."]);
  });

  test("trusts only listed commands in the workspace root whose definition is unchanged", () => {
    const trusted = [
      { command: "bun test", source: "package.json scripts.test", category: "test" as const },
      { command: "npm test", source: "package.json scripts.test", category: "test" as const, definedBy: "package.json" },
    ];
    expect(isTrustedVerification({ command: "  bun   test ", cwd: "." }, trusted, [])).toBeTrue();
    expect(isTrustedVerification({ command: "true", cwd: "." }, trusted, [])).toBeFalse();
    expect(isTrustedVerification({ command: "bun test", cwd: "src" }, trusted, [])).toBeFalse();
    expect(isTrustedVerification({ command: "npm test", cwd: "." }, trusted, [])).toBeTrue();
    expect(isTrustedVerification({ command: "npm test", cwd: "." }, trusted, ["package.json"])).toBeFalse();
  });
});
