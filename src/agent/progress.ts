import type { ModelAction } from "../model";

function stableOutcome(result: unknown): unknown {
  if (typeof result === "object" && result !== null && "status" in result && "exitCode" in result) {
    const command = result as { status?: unknown; exitCode?: unknown; stdout?: { preview?: unknown }; stderr?: { preview?: unknown } };
    return {
      status: command.status,
      exitCode: command.exitCode,
      stdout: command.stdout?.preview,
      stderr: command.stderr?.preview,
    };
  }
  return result;
}

/** How many recent observations a repeat is looked for in. Long enough to catch A,B,A,B cycles. */
export const STAGNATION_WINDOW = 6;

/**
 * Detects an action that reproduces an outcome already seen recently. The workspace fingerprint
 * is content-addressed, so an edit that is reverted and re-applied lands on the same signature:
 * oscillation (A,B,A,B) is caught, not only immediate repetition (A,A).
 */
export class ProgressTracker {
  private readonly recent: string[] = [];

  /** Returns how many times this signature occurs in the window, including this observation. */
  observe(action: ModelAction, result: unknown, workspaceFingerprint: string): number {
    const signature = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify({ action, result: stableOutcome(result), workspaceFingerprint }))
      .digest("hex");
    this.recent.push(signature);
    if (this.recent.length > STAGNATION_WINDOW) this.recent.shift();
    return this.recent.filter((seen) => seen === signature).length;
  }
}
