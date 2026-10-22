import styles from "./Spinner.module.css";

/** A ring spinner. Pass a label when it is the only sign of progress; otherwise it is decorative. */
export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <svg
      className={styles.spinner}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <circle cx="8" cy="8" r="6" fill="none" className={styles.track} strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" className={styles.arc} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The three bouncing dots from the "Thinking..." state. */
export function TypingDots() {
  return (
    <span className={styles.dots} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
