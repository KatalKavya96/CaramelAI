import type { RunRecordStatus } from "../lib/contract";
import { statusCopy } from "../lib/status";
import { Spinner } from "../ui";
import styles from "./Status.module.css";

/** A status shape that differs by form, not only colour, so it reads without colour vision. */
export function StatusIcon({ status, size = 14 }: { status: RunRecordStatus; size?: number }) {
  const { label } = statusCopy(status);
  switch (status) {
    case "preparing":
    case "running":
      return <Spinner size={size} label={label} />;
    case "queued":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className={styles.neutral}>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "verified":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className={styles.success}>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5 8.2 2 2 4-4.4" fill="none" stroke="var(--surface-solid)" strokeWidth="1.8" />
        </svg>
      );
    case "partial":
    case "blocked":
    case "budget_exhausted":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className={styles.warning}>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" />
        </svg>
      );
    case "failed":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className={styles.danger}>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5.5 5.5 5 5m0-5-5 5" stroke="var(--surface-solid)" strokeWidth="1.8" />
        </svg>
      );
    case "cancelled":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className={styles.neutral}>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4.2 11.8 11.8 4.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
  }
}

/** Icon plus label in a soft pill, for page headers. */
export function StatusBadge({ status, detail }: { status: RunRecordStatus; detail?: string }) {
  const copy = statusCopy(status);
  return (
    <span className={[styles.badge, styles[`tone-${copy.tone}`]].join(" ")} title={copy.explanation}>
      <StatusIcon status={status} />
      {copy.label}
      {detail === undefined ? null : <span className={styles.detail}>· {detail}</span>}
    </span>
  );
}
