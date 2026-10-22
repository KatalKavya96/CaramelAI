import type { ReactNode } from "react";
import { Pill } from "../ui";
import styles from "./QuickActions.module.css";

/** The row of outlined chips under the composer (Write / Explore / Code in the mockups). */
export function QuickActions({ label, actions }: { label: string; actions: { label: string; icon: ReactNode; onClick: () => void }[] }) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      {actions.map((action) => (
        <Pill key={action.label} size="lg" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Pill>
      ))}
    </div>
  );
}
