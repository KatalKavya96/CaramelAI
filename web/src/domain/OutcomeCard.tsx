import type { ReactNode } from "react";
import type { RunRecordStatus, UsageSummary } from "../lib/contract";
import { formatDuration, formatTokens } from "../lib/format";
import { statusCopy } from "../lib/status";
import { StatusIcon } from "./Status";
import styles from "./OutcomeCard.module.css";

export interface OutcomeMetrics {
  steps: number;
  modelCalls: number;
  commandsRun: number;
  durationMs: number;
}

export interface OutcomeCardProps {
  status: RunRecordStatus;
  summary: string | null;
  terminationReason: string | null;
  metrics?: OutcomeMetrics;
  usage?: UsageSummary;
  changedFileCount: number;
  actions?: ReactNode;
}

/** The end of a turn: what happened, why it stopped, and what to do next. */
export function OutcomeCard({ status, summary, terminationReason, metrics, usage, changedFileCount, actions }: OutcomeCardProps) {
  const copy = statusCopy(status);
  const tokens = usage === undefined ? null : usage.providerTotalTokens > 0 ? usage.providerTotalTokens : usage.estimatedTotalTokens;
  return (
    <section className={[styles.card, styles[`tone-${copy.tone}`]].join(" ")} aria-label={`Outcome: ${copy.label}`}>
      <header className={styles.head}>
        <StatusIcon status={status} size={20} />
        <h3 className={styles.title}>{copy.label}</h3>
      </header>
      <p className={styles.explanation}>{copy.explanation}</p>
      {summary === null || summary.trim() === "" ? null : <p className={styles.summary}>{summary}</p>}
      {terminationReason === null || status === "verified" ? null : (
        <p className={styles.reason}><span>Reason:</span> {terminationReason}</p>
      )}
      <ul className={styles.facts}>
        <li>{changedFileCount} file{changedFileCount === 1 ? "" : "s"} changed</li>
        {metrics === undefined ? null : (
          <>
            <li>{metrics.steps} steps</li>
            <li>{metrics.modelCalls} model calls</li>
            <li>{formatDuration(metrics.durationMs)}</li>
          </>
        )}
        {tokens === null ? null : <li>{formatTokens(tokens)} tokens{usage !== undefined && usage.providerTotalTokens === 0 ? " (estimated)" : ""}</li>}
      </ul>
      {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
