import type { ReactNode } from "react";
import { CloseIcon, IconButton } from "../ui";
import styles from "./PageLayout.module.css";

/** Large title and subtitle, as on the project page ("Caramel launch"). */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle === undefined ? null : <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

/** Main column plus the optional right-hand panel ("Project context" in the mockup). */
export function SplitLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={styles.split}>
      <div className={styles.mainColumn}>{children}</div>
      {aside === undefined ? null : <div className={styles.asideColumn}>{aside}</div>}
    </div>
  );
}

/** The bordered right-hand panel with a title and close button. */
export function SidePanel({ title, onClose, children, label }: { title: string; onClose?: () => void; children: ReactNode; label?: string }) {
  return (
    <aside className={styles.panel} aria-label={label ?? title}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {onClose === undefined ? null : <IconButton label={`Close ${title}`} icon={<CloseIcon size={18} />} onClick={onClose} />}
      </div>
      {children}
    </aside>
  );
}

/** A small heading inside a panel ("Files", "Instructions"). */
export function PanelSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panelSection}>
      <div className={styles.panelSectionHeader}>
        <h3 className={styles.panelSectionTitle}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The page body with the standard gutters and max width. */
export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={[styles.page, narrow ? styles.narrow : ""].join(" ")}>{children}</div>;
}
