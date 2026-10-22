import type { ReactNode } from "react";
import styles from "./TopBar.module.css";

/** The row above the content: a pill on the left (model or breadcrumb), actions on the right. */
export function TopBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <div className={styles.bar}>
      <div className={styles.start}>{start}</div>
      <div className={styles.end}>{end}</div>
    </div>
  );
}
