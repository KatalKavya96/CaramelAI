import styles from "./ProgressBar.module.css";

/** The thin rounded bar from the upload and plan-usage mockups. */
export function ProgressBar({ value, max, label, tone = "accent" }: { value: number; max: number; label: string; tone?: "accent" | "warning" | "danger" }) {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className={styles.track}>
      <div className={[styles.fill, styles[tone]].join(" ")} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
