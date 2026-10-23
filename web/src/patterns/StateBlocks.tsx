import type { ReactNode } from "react";
import { AlertIcon, Button, RetryIcon, SearchIcon, TypingDots } from "../ui";
import styles from "./StateBlocks.module.css";

/** "Something went wrong" from the interaction-states mockup, with a specific message and Retry. */
export function ErrorBanner({ message, onRetry, action }: { message: string; onRetry?: () => void; action?: ReactNode }) {
  return (
    <div className={styles.error} role="alert">
      <span className={styles.errorIcon}><AlertIcon size={20} /></span>
      <span className={styles.errorText}>{message}</span>
      {action}
      {onRetry === undefined ? null : <Button icon={<RetryIcon size={18} />} onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/** "Thinking..." with the dots and an optional stop control. */
export function WorkingBanner({ label, trailing }: { label: string; trailing?: ReactNode }) {
  return (
    <div className={styles.working} role="status">
      <span className={styles.workingText}>{label}</span>
      <TypingDots />
      <span className={styles.spacer} />
      {trailing}
    </div>
  );
}

/** "No chats found" style empty state. */
export function EmptyState({ title, message, icon, action }: { title: string; message?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>{icon ?? <SearchIcon size={22} />}</span>
      <p className={styles.emptyTitle}>{title}</p>
      {message === undefined ? null : <p className={styles.emptyMessage}>{message}</p>}
      {action}
    </div>
  );
}

/** A block of grey bars shown while content loads. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading…"><span className="visually-hidden">Loading…</span><div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} style={{ width: `${90 - index * 15}%` }} />
      ))}
    </div></div>
  );
}
