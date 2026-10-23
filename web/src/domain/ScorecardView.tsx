import type { ModelSummary, Scorecard } from "../lib/contract";
import { formatDuration, formatTokens, formatWhen } from "../lib/format";
import { findings, formatRate, formatUsd, type Finding } from "../lib/scorecard";
import { AlertIcon } from "../ui";
import styles from "./ScorecardView.module.css";

const FINDING_COPY: Record<Finding, string> = {
  false_success: "Said verified, but the hidden check failed",
  regression: "Fixed the task, broke something else",
  provider_error: "The provider failed; not counted",
  infrastructure: "The evaluator could not score it",
};

/** Higher is better for solve rate, lower for the rest. Only a clear winner gets a mark: a tie says nothing. */
function best(models: readonly ModelSummary[], pick: (model: ModelSummary) => number | null, lowerIsBetter: boolean): number | null {
  const values = models.map(pick).filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const top = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  return values.filter((value) => value === top).length === 1 ? top : null;
}

/** One scorecard from `benchmark agent`: model comparison, per-task grid and the runs worth a look. */
export function ScorecardView({ scorecard }: { scorecard: Scorecard }) {
  const { models, runs } = scorecard;
  const columns: { label: string; hint: string; value: (model: ModelSummary) => string; raw: (model: ModelSummary) => number | null; lowerIsBetter: boolean }[] = [
    { label: "Solved", hint: "Runs the hidden checks scored as solved, out of runs that counted.", value: (m) => `${formatRate(m.solveRate)} (${m.solved}/${m.scored})`, raw: (m) => m.solveRate, lowerIsBetter: false },
    { label: "Dev / held out", hint: "Solve rate on tasks you may tune the agent against, then on tasks kept back to catch overfitting.", value: (m) => `${formatRate(m.solveRateBySplit.development)} / ${formatRate(m.solveRateBySplit.heldOut)}`, raw: (m) => m.solveRateBySplit.heldOut, lowerIsBetter: false },
    { label: "False success", hint: "When the agent said verified, how often it was wrong.", value: (m) => `${formatRate(m.falseSuccessRate)} (${m.falseSuccesses}/${m.verifiedClaims})`, raw: (m) => m.falseSuccessRate, lowerIsBetter: true },
    { label: "Regressions", hint: "Task check passed but an existing behaviour broke.", value: (m) => formatRate(m.regressionRate), raw: (m) => m.regressionRate, lowerIsBetter: true },
    { label: "Cost / solved", hint: "Dollars the provider reported, divided by solved runs.", value: (m) => `${formatUsd(m.costPerSolvedUsd)}${m.costComplete ? "" : " *"}`, raw: (m) => m.costPerSolvedUsd, lowerIsBetter: true },
    { label: "Tokens / solved", hint: "All tokens spent, divided by solved runs.", value: (m) => (m.tokensPerSolved === null ? "–" : formatTokens(Math.round(m.tokensPerSolved))), raw: (m) => m.tokensPerSolved, lowerIsBetter: true },
    { label: "Time / solved", hint: "Wall-clock time spent, divided by solved runs.", value: (m) => (m.durationPerSolvedMs === null ? "–" : formatDuration(m.durationPerSolvedMs)), raw: (m) => m.durationPerSolvedMs, lowerIsBetter: true },
  ];
  const tasks = [...new Map(runs.filter((run) => run.outcome !== "skipped_budget").map((run) => [run.taskId, run.split])).entries()];
  const flagged = findings(runs);
  const skipped = runs.filter((run) => run.outcome === "skipped_budget").length;
  const totalCost = models.reduce((sum, model) => sum + model.costUsd, 0);
  const costIncomplete = models.some((model) => !model.costComplete);

  return (
    <div className={styles.view}>
      <dl className={styles.meta}>
        <div><dt>Recorded</dt><dd>{formatWhen(scorecard.recordedAt)}</dd></div>
        <div><dt>Provider</dt><dd>{scorecard.provider}</dd></div>
        <div><dt>Runs</dt><dd>{runs.length - skipped} of {runs.length} · {scorecard.repeats} per task</dd></div>
        <div><dt>Spent</dt><dd>{formatUsd(totalCost)}{costIncomplete ? " or more" : ""}{scorecard.maxCostUsd === null ? "" : ` of ${formatUsd(scorecard.maxCostUsd)} limit`}</dd></div>
        <div><dt>Harness</dt><dd><code>{scorecard.harnessRevision?.slice(0, 7) ?? "unknown"}</code></dd></div>
      </dl>

      {scorecard.stoppedEarly === null ? null : (
        <p className={styles.warning} role="note"><AlertIcon size={16} /> Stopped early: {scorecard.stoppedEarly} {skipped} run{skipped === 1 ? " was" : "s were"} not started, so compare models on the tasks they all reached.</p>
      )}

      <section aria-labelledby="scorecard-models">
        <h2 id="scorecard-models" className={styles.heading}>Models</h2>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Model</th>
                {columns.map((column) => <th key={column.label} scope="col" title={column.hint}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.model}>
                  <th scope="row">
                    <code>{model.model}</code>
                    {model.providerErrors > 0 ? <span className={styles.sub}>{model.providerErrors} provider error{model.providerErrors === 1 ? "" : "s"} left out</span> : null}
                  </th>
                  {columns.map((column) => {
                    const top = best(models, column.raw, column.lowerIsBetter);
                    const isBest = top !== null && column.raw(model) === top;
                    return <td key={column.label} className={isBest ? styles.best : undefined}>{column.value(model)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.footnote}>
          Small samples swing a lot: with {scorecard.repeats} attempt{scorecard.repeats === 1 ? "" : "s"} per task, one run moves a rate by several points.
          {costIncomplete ? " * Some calls did not report cost, so this is a lower bound." : ""}
        </p>
      </section>

      <section aria-labelledby="scorecard-tasks">
        <h2 id="scorecard-tasks" className={styles.heading}>Tasks</h2>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Task</th>
                {models.map((model) => <th key={model.model} scope="col"><code>{model.model.split("/").at(-1)}</code></th>)}
              </tr>
            </thead>
            <tbody>
              {tasks.map(([taskId, split]) => (
                <tr key={taskId}>
                  <th scope="row"><code>{taskId}</code>{split === "held_out" ? <span className={styles.tag}>held out</span> : null}</th>
                  {models.map((model) => {
                    const entry = model.perTask.find((task) => task.taskId === taskId);
                    if (entry === undefined) return <td key={model.model} className={styles.none}>–</td>;
                    const tone = entry.solved === entry.attempts ? styles.pass : entry.solved === 0 ? styles.fail : styles.mixed;
                    return <td key={model.model}><span className={tone}>{entry.solved}/{entry.attempts}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="scorecard-findings">
        <h2 id="scorecard-findings" className={styles.heading}>Runs worth a look</h2>
        {flagged.length === 0 ? (
          <p className={styles.footnote}>No false successes, regressions or errors.</p>
        ) : (
          <ul className={styles.findings}>
            {flagged.map(({ run, finding }) => (
              <li key={run.directory} className={finding === "false_success" || finding === "regression" ? styles.serious : undefined}>
                <span className={styles.findingLabel}>{FINDING_COPY[finding]}</span>
                <span><code>{run.model}</code> on <code>{run.taskId}</code>, attempt {run.attempt}</span>
                <code className={styles.path} title="Folder next to scorecard.json with this run's log, patch and evaluation">{run.directory}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
