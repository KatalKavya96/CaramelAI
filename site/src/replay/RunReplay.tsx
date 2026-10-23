import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DiffView } from "@web/domain/DiffView";
import { EvidenceList } from "@web/domain/EvidenceList";
import { OutcomeCard } from "@web/domain/OutcomeCard";
import { StatusBadge } from "@web/domain/Status";
import { StepTimeline } from "@web/domain/StepTimeline";
import { parseUnifiedDiff } from "@web/lib/diff";
import { repoLabel, taskTitle } from "@web/lib/format";
import { FolderIcon, RetryIcon, ShieldIcon } from "@web/ui/icons";
import type { ReplayRun } from "./types";
import { useReplay } from "./useReplay";
import styles from "./RunReplay.module.css";

function PlayIcon() {
  return <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>;
}

function PauseIcon() {
  return <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor" /></svg>;
}

function provenanceLine(run: ReplayRun): string {
  if (run.provenance === "example") return "Example run, written by hand to show the format. Not a recording.";
  const when = run.recordedAt === undefined ? "" : ` on ${new Date(run.recordedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  return `Recorded${when} with ${run.model}. Paths and secrets redacted, nothing else edited.`;
}

/** The task is shown from the first frame, before run_started has been replayed. */
function runTask(run: ReplayRun): string {
  const first = run.events[0];
  return first?.type === "run_started" ? first.payload.task : "";
}

/** A recorded run played back through the app's own components, with tabs to switch runs. */
export function RunReplay({ runs }: { runs: ReplayRun[] }) {
  const [index, setIndex] = useState(0);
  const run = runs[index] as ReplayRun;
  const replay = useReplay(run.events);
  const { state } = replay;
  const files = useMemo(() => parseUnifiedDiff(run.patch), [run.patch]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabsId = useId();

  // Follow the newest step while playing, like a terminal would.
  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null && replay.playing) node.scrollTop = node.scrollHeight;
  }, [state, replay.playing]);

  const gate = state.run.rejections.filter((rejection) => rejection.action === "finish");
  const status = state.run.status === "starting" ? "preparing" : state.run.status;

  return (
    <figure className={styles.window} aria-label="Replay of a Caramel run">
      <div className={styles.tabs} role="tablist" aria-label="Runs">
        {runs.map((item, position) => (
          <button
            key={item.id}
            id={`${tabsId}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={position === index}
            aria-controls={`${tabsId}-panel`}
            className={styles.tab}
            onClick={() => setIndex(position)}
          >
            {item.label}
          </button>
        ))}
        {run.provenance === "example" ? <span className={styles.example}>Example</span> : null}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${run.id}`} className={styles.panel}>
        <header className={styles.head}>
          <div className={styles.headMain}>
            <p className={styles.task}>{taskTitle(runTask(run), 90)}</p>
            <p className={styles.meta}>
              <span><FolderIcon size={14} /> {repoLabel(run.repoUrl)}</span>
              <span>{run.model}</span>
            </p>
          </div>
          <StatusBadge status={status} />
        </header>

        <div ref={scrollRef} className={styles.scroll} tabIndex={0} aria-label="Steps so far">
          <StepTimeline steps={state.run.steps} outputs={state.stepOutputs} live={!replay.done} />

          {gate.map((rejection, position) => (
            <p key={position} className={styles.gate}>
              <ShieldIcon size={16} />
              <span><strong>The harness refused to let it finish.</strong> {rejection.error.replace(/^Finish rejected:\s*/, "")}</span>
            </p>
          ))}

          {replay.done ? (
            <div className={styles.result}>
              <OutcomeCard
                status={run.status}
                summary={run.summary}
                terminationReason={run.terminationReason}
                changedFileCount={files.length}
                {...(run.metrics === undefined ? {} : { metrics: run.metrics })}
                {...(run.usage === undefined ? {} : { usage: run.usage })}
              />
              <section aria-label="Checks">
                <h3 className={styles.subhead}>Checks the harness ran</h3>
                <EvidenceList evidence={run.evidence} />
              </section>
              <details className={styles.diff}>
                <summary>The patch ({files.length} file{files.length === 1 ? "" : "s"})</summary>
                <DiffView files={files} />
              </details>
            </div>
          ) : null}
        </div>

        <footer className={styles.controls}>
          <button
            type="button"
            className={styles.control}
            onClick={replay.done ? replay.restart : replay.playing ? replay.pause : replay.play}
            aria-label={replay.done ? "Replay from the start" : replay.playing ? "Pause" : "Play"}
          >
            {replay.done ? <RetryIcon size={16} /> : replay.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className={styles.track} aria-hidden="true">
            <div className={styles.fill} style={{ width: `${replay.progress * 100}%` }} />
          </div>
        </footer>
      </div>
      <figcaption className={styles.caption}>{provenanceLine(run)}</figcaption>
    </figure>
  );
}
