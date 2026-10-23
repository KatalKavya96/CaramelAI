import type { AgentRunRecord, Scorecard } from "./contract";

/**
 * Reads a scorecard.json picked by the user. The file comes from disk, not from this app, so only
 * the shape the screen relies on is checked; a wrong file gets a sentence, not a blank screen.
 */
export function parseScorecard(text: string): Scorecard {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not JSON. Pick the scorecard.json that `benchmark agent` wrote.");
  }
  const card = value as Partial<Scorecard> | null;
  if (typeof card !== "object" || card === null || !("schemaVersion" in card)) {
    throw new Error("This JSON is not a benchmark scorecard. Pick the scorecard.json that `benchmark agent` wrote.");
  }
  if (card.schemaVersion !== 1) throw new Error(`This scorecard uses format ${String(card.schemaVersion)}; this app reads format 1.`);
  if (!Array.isArray(card.models) || !Array.isArray(card.runs) || typeof card.recordedAt !== "string") {
    throw new Error("This scorecard is incomplete: it has no models or runs.");
  }
  return card as Scorecard;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

export function formatUsd(amount: number | null): string {
  if (amount === null) return "–";
  if (amount === 0) return "$0";
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

export type Finding = "false_success" | "regression" | "provider_error" | "infrastructure";

/**
 * Runs worth opening, most serious first. A false success leads: the agent said "verified" and
 * was wrong, which is the failure a user cannot see from the app.
 */
export function findings(runs: readonly AgentRunRecord[]): { run: AgentRunRecord; finding: Finding }[] {
  const order: Finding[] = ["false_success", "regression", "provider_error", "infrastructure"];
  const found = runs.flatMap((run): { run: AgentRunRecord; finding: Finding }[] => {
    if (run.claimedVerified && run.outcome !== "solved" && run.outcome !== "provider_error" && run.outcome !== "skipped_budget") return [{ run, finding: "false_success" }];
    if (run.taskCheckPassed === true && run.regressionCheckPassed === false) return [{ run, finding: "regression" }];
    if (run.outcome === "provider_error") return [{ run, finding: "provider_error" }];
    if (run.outcome === "infrastructure_error" || run.outcome === "invalid_submission") return [{ run, finding: "infrastructure" }];
    return [];
  });
  return found.sort((a, b) => order.indexOf(a.finding) - order.indexOf(b.finding));
}
