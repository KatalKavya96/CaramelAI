import type { CommandResult } from "../execution";

export type VerificationStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "not_run"
  | "timed_out"
  | "unknown";

export interface ParsedTestCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface VerificationEvidence {
  id: string;
  codeFingerprint: string;
  command: string;
  cwd: string;
  status: VerificationStatus;
  exitCode: number | null;
  durationMs: number;
  timeoutMs: number;
  stdoutLogPath: string;
  stderrLogPath: string;
  testCounts: ParsedTestCounts | null;
  baseline: boolean;
  /** True only when the controller, not the model, chose this command as a completion check. */
  trusted: boolean;
}

export interface DiscoveredCheck {
  command: string;
  source: string;
  category: "test" | "build" | "lint" | "typecheck";
  /** Workspace file whose contents define what this command runs, such as package.json for `npm test`. */
  definedBy?: string;
}
