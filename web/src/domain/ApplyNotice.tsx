import type { ApplyResult } from "../lib/contract";
import { repoLabel } from "../lib/format";
import { AlertIcon, CheckIcon } from "../ui";
import styles from "./ApplyNotice.module.css";

/** What applying a thread did, as data: the data layer's outcome without the run ids. */
export type ApplyNoticeOutcome =
  | { ok: true; files: string[]; skipped: number }
  | { ok: false; turn: number; turns: number; result: Exclude<ApplyResult, { applied: true }> };

/** The result of "Apply to my folder": what changed, or which turn could not apply and why. */
export function ApplyNotice({ outcome, folder }: { outcome: ApplyNoticeOutcome; folder: string }) {
  const name = repoLabel(folder);
  if (outcome.ok) {
    return (
      <div className={[styles.notice, styles.ok].join(" ")} role="status">
        <CheckIcon size={18} />
        <div>
          <p className={styles.title}>
            {outcome.files.length === 0 ? `Everything was already in ${name}.` : `Applied ${outcome.files.length} file${outcome.files.length === 1 ? "" : "s"} to ${name}.`}
          </p>
          {outcome.files.length === 0 ? null : <p className={styles.detail}>Review them with <code>git diff</code> before you commit.</p>}
        </div>
      </div>
    );
  }
  const which = outcome.turns > 1 ? `Turn ${outcome.turn}` : "This run";
  return (
    <div className={[styles.notice, styles.bad].join(" ")} role="alert">
      <AlertIcon size={18} />
      <div>
        <p className={styles.title}>{which} could not be applied. Nothing in {name} was changed by it.</p>
        {outcome.result.reason === "conflicts" ? (
          <>
            <p className={styles.detail}>These files changed in your folder since the run started:</p>
            <ul className={styles.files}>{outcome.result.conflicts.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
            <p className={styles.detail}>Commit or stash your edits and try again, or download the patch and merge it yourself.</p>
          </>
        ) : (
          <p className={styles.detail}>{outcome.result.message}</p>
        )}
        {outcome.turn > 1 ? <p className={styles.detail}>Earlier turns were applied first, because each follow-up builds on the one before.</p> : null}
      </div>
    </div>
  );
}
