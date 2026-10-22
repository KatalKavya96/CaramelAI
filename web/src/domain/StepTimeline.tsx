import { useEffect, useState } from "react";
import type { RunStepView } from "../lib/contract";
import { describeAction, formatClock, formatDuration } from "../lib/format";
import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, Spinner } from "../ui";
import styles from "./StepTimeline.module.css";

export interface StepOutputView {
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  truncated: boolean;
}

export interface StepTimelineProps {
  steps: RunStepView[];
  outputs?: Record<number, StepOutputView>;
  startedAt?: Record<number, string>;
  rejections?: { action: string; error: string }[];
  /** False once the run has finished: a step without an outcome is then shown as interrupted. */
  live: boolean;
  now?: number;
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/** One row per agent step: number, outcome, action and target, intent, and command output on demand. */
export function StepTimeline({ steps, outputs = {}, startedAt = {}, rejections = [], live, now }: StepTimelineProps) {
  const running = live && steps.some((step) => step.outcome === undefined);
  const clock = useNow(running && now === undefined);
  const current = now ?? clock;
  if (steps.length === 0 && rejections.length === 0) return null;
  return (
    <div className={styles.wrap}>
      <ol className={styles.list} aria-label="Steps">
        {steps.map((step) => (
          <StepRow
            key={step.step}
            step={step}
            output={outputs[step.step]}
            elapsed={step.outcome === undefined && startedAt[step.step] !== undefined ? current - Date.parse(startedAt[step.step] as string) : undefined}
            live={live}
          />
        ))}
      </ol>
      {rejections.length === 0 ? null : (
        <details className={styles.rejections}>
          <summary>{rejections.length} action{rejections.length === 1 ? "" : "s"} the harness rejected before running</summary>
          <ul>
            {rejections.map((rejection, index) => (
              <li key={index}><code>{rejection.action}</code> {rejection.error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StepRow({ step, output, elapsed, live }: { step: RunStepView; output: StepOutputView | undefined; elapsed: number | undefined; live: boolean }) {
  const [open, setOpen] = useState(false);
  const pending = step.outcome === undefined;
  const state = pending ? (live ? "running" : "interrupted") : step.outcome?.ok === true ? "ok" : "failed";
  const hasOutput = output !== undefined && output.output.trim() !== "";
  const purpose = step.action.type === "run_command" ? step.action.purpose : undefined;
  return (
    <li className={[styles.row, state === "running" ? styles.running : ""].join(" ")}>
      <span className={styles.number}>{step.step}</span>
      <span className={styles.state}>
        {state === "running" ? <Spinner size={16} label="Running" /> : null}
        {state === "ok" ? <CheckIcon size={16} className={styles.ok} role="img" aria-label="Succeeded" aria-hidden={undefined} /> : null}
        {state === "failed" ? <AlertIcon size={16} className={styles.fail} role="img" aria-label="Failed" aria-hidden={undefined} /> : null}
        {state === "interrupted" ? <span className={styles.interrupted} role="img" aria-label="Did not finish">–</span> : null}
      </span>
      <div className={styles.body}>
        <div className={styles.line}>
          <code className={styles.action}>{step.action.type}</code>
          <code className={styles.target}>{describeAction(step.action)}</code>
        </div>
        {step.intent === undefined ? null : <p className={styles.intent}>{step.intent}</p>}
        {purpose === "verification" ? <p className={styles.tag}>Verification check</p> : null}
        {step.outcome?.error === undefined ? null : <p className={styles.error}>{step.outcome.error}</p>}
        {hasOutput ? (
          <>
            <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
              Output{output.exitCode === null ? "" : ` · exit ${output.exitCode}`}
            </button>
            {open ? (
              <pre className={styles.output} tabIndex={0} aria-label={`Output of step ${step.step}`}>
                {output.output}
                {output.truncated ? "\n… output truncated" : ""}
              </pre>
            ) : null}
          </>
        ) : null}
      </div>
      <span className={styles.time}>
        {elapsed !== undefined ? formatClock(elapsed) : output?.durationMs !== null && output?.durationMs !== undefined ? formatDuration(output.durationMs) : ""}
      </span>
    </li>
  );
}
