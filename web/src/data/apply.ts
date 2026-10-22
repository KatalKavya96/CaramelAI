import type { ApplyResult } from "../lib/contract";
import type { ApiClient } from "./api";

export type ThreadApplyOutcome =
  | { ok: true; files: string[]; skipped: number }
  | { ok: false; failedRunId: string; turn: number; result: Exclude<ApplyResult, { applied: true }> };

/**
 * Applies a thread's turns to the user's folder, oldest first. A follow-up's patch builds on its
 * parent's, so each turn needs the one before it in place; a turn that is already in the folder
 * counts as done. Stops at the first turn that cannot apply and says which one.
 */
export async function applyThread(api: Pick<ApiClient, "applyRun">, runIds: string[]): Promise<ThreadApplyOutcome> {
  const files = new Set<string>();
  let skipped = 0;
  for (const [index, id] of runIds.entries()) {
    const result = await api.applyRun(id);
    if (result.applied) {
      for (const file of result.files) files.add(file);
      continue;
    }
    if (result.reason === "already_applied" || result.reason === "no_changes") {
      skipped += 1;
      continue;
    }
    return { ok: false, failedRunId: id, turn: index + 1, result };
  }
  return { ok: true, files: [...files], skipped };
}
