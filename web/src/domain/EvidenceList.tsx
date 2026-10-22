import type { VerificationEvidence } from "../lib/contract";
import { formatDuration } from "../lib/format";
import { AlertIcon, CheckIcon, ClockIcon } from "../ui";
import styles from "./EvidenceList.module.css";

export type EvidenceView = Omit<VerificationEvidence, "stdoutLogPath" | "stderrLogPath">;

const LABEL: Record<EvidenceView["status"], string> = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  not_run: "Not run",
  timed_out: "Timed out",
  unknown: "Unknown",
};

/**
 * The checks the harness ran. Baseline runs (before any change) are kept apart, and a check the
 * model picked itself is marked, because only controller-chosen checks count towards "Verified".
 */
export function EvidenceList({ evidence }: { evidence: EvidenceView[] }) {
  if (evidence.length === 0) return <p className={styles.empty}>No checks were run.</p>;
  const final = evidence.filter((item) => !item.baseline);
  const baseline = evidence.filter((item) => item.baseline);
  return (
    <div className={styles.wrap}>
      <ul className={styles.list}>{final.map((item) => <Row key={item.id} item={item} />)}</ul>
      {baseline.length === 0 ? null : (
        <details className={styles.baseline}>
          <summary>Before any change ({baseline.length})</summary>
          <ul className={styles.list}>{baseline.map((item) => <Row key={item.id} item={item} />)}</ul>
        </details>
      )}
    </div>
  );
}

function Row({ item }: { item: EvidenceView }) {
  const ok = item.status === "passed";
  const bad = item.status === "failed" || item.status === "timed_out";
  const counts = item.testCounts;
  return (
    <li className={styles.row}>
      <span className={ok ? styles.ok : bad ? styles.bad : styles.neutral}>
        {ok ? <CheckIcon size={16} /> : bad ? <AlertIcon size={16} /> : <ClockIcon size={16} />}
      </span>
      <div className={styles.body}>
        <code className={styles.command}>{item.command}</code>
        <span className={styles.meta}>
          {LABEL[item.status]}
          {item.exitCode === null ? "" : ` · exit ${item.exitCode}`}
          {` · ${formatDuration(item.durationMs)}`}
          {counts === null ? "" : ` · ${counts.passed} passed${counts.failed > 0 ? `, ${counts.failed} failed` : ""}${counts.skipped > 0 ? `, ${counts.skipped} skipped` : ""}`}
          {item.trusted ? "" : " · chosen by the model"}
        </span>
      </div>
    </li>
  );
}
