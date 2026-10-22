import type { ReactNode } from "react";
import { formatWhen } from "../lib/format";
import { Avatar } from "../ui";
import styles from "./TurnCard.module.css";

export interface TurnCardProps {
  userName: string;
  task: string;
  createdAt: string;
  /** Collapsed turns (earlier runs in the thread) show only the task and outcome line. */
  collapsed?: boolean;
  onExpand?: () => void;
  outcome?: ReactNode;
  children?: ReactNode;
}

/** One turn of a run thread: the request, as a right-aligned bubble, then the run's work and outcome. */
export function TurnCard({ userName, task, createdAt, collapsed = false, onExpand, outcome, children }: TurnCardProps) {
  return (
    <article className={styles.turn}>
      <div className={styles.request}>
        <div className={styles.bubble}>
          <p className={styles.task}>{task}</p>
          <time className={styles.when} dateTime={createdAt}>{formatWhen(createdAt)}</time>
        </div>
        <Avatar name={userName} size={32} />
      </div>
      {collapsed ? (
        <div className={styles.collapsed}>
          {outcome}
          {onExpand === undefined ? null : (
            <button type="button" className={styles.expand} onClick={onExpand}>Show steps</button>
          )}
        </div>
      ) : (
        <div className={styles.work}>
          {children}
          {outcome}
        </div>
      )}
    </article>
  );
}
