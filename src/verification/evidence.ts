import type { CommandResult } from "../execution";
import type { RepositoryMetadata } from "../tools";
import type { DiscoveredCheck, ParsedTestCounts, VerificationEvidence, VerificationStatus } from "./types";

function count(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  return match === null ? null : Number(match[1]);
}

export function parseTestCounts(result: CommandResult): ParsedTestCounts | null {
  const text = `${result.stdout.preview}\n${result.stderr.preview}`;
  const passed = count(/(?:^|\s)(\d+)\s+(?:pass|passed)\b/im, text);
  const failed = count(/(?:^|\s)(\d+)\s+(?:fail|failed)\b/im, text);
  const skipped = count(/(?:^|\s)(\d+)\s+(?:skip|skipped)\b/im, text);
  const collected = count(/(?:collected\s+|ran\s+)?(\d+)\s+(?:tests?|items?)\b/im, text);
  if (passed === null && failed === null && skipped === null && collected === null) return null;
  const resolvedPassed = passed ?? 0;
  const resolvedFailed = failed ?? 0;
  const resolvedSkipped = skipped ?? 0;
  return {
    passed: resolvedPassed,
    failed: resolvedFailed,
    skipped: resolvedSkipped,
    total: collected ?? resolvedPassed + resolvedFailed + resolvedSkipped,
  };
}

export function verificationStatus(result: CommandResult, counts: ParsedTestCounts | null): VerificationStatus {
  if (result.status === "timed_out") return "timed_out";
  if (result.status === "runner_error" || result.exitCode === null) return "unknown";
  if (result.exitCode !== 0) return "failed";
  if (counts !== null && counts.total === 0) return "unknown";
  if (counts !== null && counts.passed === 0 && counts.failed === 0 && counts.skipped > 0) return "skipped";
  return "passed";
}

export function createEvidence(options: {
  result: CommandResult;
  codeFingerprint: string;
  baseline: boolean;
  trusted?: boolean;
}): VerificationEvidence {
  const testCounts = parseTestCounts(options.result);
  return {
    id: options.result.commandId,
    codeFingerprint: options.codeFingerprint,
    command: options.result.command,
    cwd: options.result.cwd,
    status: verificationStatus(options.result, testCounts),
    exitCode: options.result.exitCode,
    durationMs: options.result.durationMs,
    timeoutMs: options.result.timeoutMs,
    stdoutLogPath: options.result.stdout.logPath,
    stderrLogPath: options.result.stderr.logPath,
    testCounts,
    baseline: options.baseline,
    trusted: options.trusted ?? false,
  };
}

function packageTestScript(packageJson: unknown): string | null {
  if (typeof packageJson !== "object" || packageJson === null) return null;
  const scripts = (packageJson as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) return null;
  const test = (scripts as { test?: unknown }).test;
  return typeof test === "string" && test.trim() !== "" ? test.trim() : null;
}

// Package-manager commands that all run the `scripts.test` entry of package.json.
const PACKAGE_TEST_ALIASES = ["npm test", "npm run test", "bun run test", "pnpm test", "yarn test"];

export function discoverChecks(
  metadata: RepositoryMetadata,
  options: { packageJson?: unknown } = {},
): DiscoveredCheck[] {
  const found: DiscoveredCheck[] = [];
  const manifests = new Set(metadata.manifests);
  const configs = new Set(metadata.testConfigs);
  if (manifests.has("package.json")) {
    const script = packageTestScript(options.packageJson);
    if (script !== null) {
      const source = "package.json scripts.test";
      found.push({ command: script, source, category: "test" });
      for (const alias of PACKAGE_TEST_ALIASES) {
        if (alias !== script) found.push({ command: alias, source, category: "test", definedBy: "package.json" });
      }
    } else if (manifests.has("bun.lock") || manifests.has("bun.lockb") || configs.has("bunfig.toml")) {
      found.push({ command: "bun test", source: "Bun project", category: "test" });
    }
  }
  if (manifests.has("pyproject.toml") || manifests.has("requirements.txt") || configs.has("pytest.ini")) {
    found.push({ command: "python -m pytest", source: configs.has("pytest.ini") ? "pytest.ini" : "Python manifest", category: "test" });
  }
  if (manifests.has("Cargo.toml")) found.push({ command: "cargo test", source: "Cargo.toml", category: "test" });
  if (manifests.has("go.mod")) found.push({ command: "go test ./...", source: "go.mod", category: "test" });
  return found;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/**
 * The completion gate's rule: a command counts as verification only if the controller listed it,
 * it ran from the workspace root, and the agent has not edited the file that defines what it runs.
 * Matching is exact (after whitespace normalization) so a narrower or altered command cannot pass.
 */
export function isTrustedVerification(
  run: { command: string; cwd: string },
  trustedChecks: readonly DiscoveredCheck[],
  changedFiles: readonly string[],
): boolean {
  if (run.cwd !== ".") return false;
  const command = normalizeCommand(run.command);
  return trustedChecks.some((check) =>
    normalizeCommand(check.command) === command &&
    (check.definedBy === undefined || !changedFiles.includes(check.definedBy)),
  );
}

/**
 * True when the latest trusted check for this code state passed and no later check on the same
 * state (trusted or not) failed or timed out.
 */
export function finalStateVerified(records: readonly VerificationEvidence[], fingerprint: string): boolean {
  let verified = false;
  for (const record of evidenceForFinalState(records, fingerprint)) {
    if (record.trusted) verified = record.status === "passed";
    else if (record.status === "failed" || record.status === "timed_out") verified = false;
  }
  return verified;
}

export function evidenceForFinalState(records: readonly VerificationEvidence[], fingerprint: string): VerificationEvidence[] {
  return records.filter((record) => record.codeFingerprint === fingerprint);
}
