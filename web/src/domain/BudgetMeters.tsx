import { formatDuration } from "../lib/format";
import { ProgressBar } from "../ui";
import styles from "./BudgetMeters.module.css";

export interface BudgetUse {
  steps: number;
  maxSteps: number;
  elapsedMs: number;
  maxMinutes: number;
  modelCalls: number;
  maxModelCalls: number;
}

function tone(value: number, max: number): "accent" | "warning" | "danger" {
  const share = max === 0 ? 0 : value / max;
  return share >= 0.95 ? "danger" : share >= 0.75 ? "warning" : "accent";
}

/** How much of each budget a run has spent. A run stops at whichever limit it reaches first. */
export function BudgetMeters({ use }: { use: BudgetUse }) {
  const minutes = use.elapsedMs / 60_000;
  const rows = [
    { label: "Steps", value: use.steps, max: use.maxSteps, text: `${use.steps} / ${use.maxSteps}` },
    { label: "Time", value: minutes, max: use.maxMinutes, text: `${formatDuration(use.elapsedMs)} / ${use.maxMinutes}m` },
    { label: "Model calls", value: use.modelCalls, max: use.maxModelCalls, text: `${use.modelCalls} / ${use.maxModelCalls}` },
  ];
  return (
    <dl className={styles.list}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <dt>{row.label}</dt>
          <dd>{row.text}</dd>
          <div className={styles.bar}>
            <ProgressBar value={Math.min(row.value, row.max)} max={row.max} label={`${row.label} used`} tone={tone(row.value, row.max)} />
          </div>
        </div>
      ))}
    </dl>
  );
}
