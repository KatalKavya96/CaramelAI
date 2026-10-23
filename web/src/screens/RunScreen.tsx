import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, apiErrorMessage, useApi, useCancelRun, usePatch, useRun, useRunEvents, useRunFinishedRefresh, useRunResult, useRuns, useSession, useStartRun, useCapabilities, useApplyThread, type LiveRunState, type StreamStatus } from "../data";
import { ApplyNotice, BudgetMeters, ChangedFiles, sandboxLabel, DiffView, EvidenceList, FollowUpComposer, OutcomeCard, RunHeader, StepTimeline, TurnCard } from "../domain";
import type { RunView } from "../lib/contract";
import { downloadText } from "../lib/download";
import { parseUnifiedDiff } from "../lib/diff";
import { sourceRef, sourceUrl } from "../lib/format";
import { isActive, isTerminal } from "../lib/status";
import { ConfirmDialog, EmptyState, ErrorBanner, PanelSection, SidePanel, Skeleton, WorkingBanner } from "../patterns";
import { Button, CheckIcon, DownloadIcon, SegmentedControl, SelectField, StopIcon, TypingDots } from "../ui";
import { INITIAL_LIVE_RUN } from "../data/live-run";
import { useDraft } from "../patterns/useDraft";
import styles from "./screens.module.css";

/**
 * The run thread: root run, its follow-ups in order, then the follow-up box. A follow-up is its own
 * immutable run, so the page is a chain of runs rather than an editable conversation.
 */
function threadOf(id: string, runs: RunView[], current: RunView | undefined): RunView[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  if (current !== undefined) byId.set(current.id, current);
  const start = byId.get(id);
  if (start === undefined) return [];
  const up: RunView[] = [start];
  for (let run = start; run.parentRunId !== null && byId.has(run.parentRunId); ) {
    run = byId.get(run.parentRunId) as RunView;
    up.unshift(run);
  }
  // Continue down the newest follow-up of each run, so opening an old turn still shows the latest.
  for (let run = start; ; ) {
    const next = run.childRunIds.map((child) => byId.get(child)).find((child) => child !== undefined);
    if (next === undefined) break;
    up.push(next);
    run = next;
  }
  return up;
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? apiErrorMessage(error.status, error.code, error.issues, error.detail) : "Something went wrong.";
}

export function RunScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const runs = useRuns();
  const run = useRun(id);
  const thread = useMemo(() => threadOf(id, runs.data ?? [], run.data), [id, runs.data, run.data]);
  const latest = thread.at(-1);

  if (run.isLoading) return <div className={styles.runPage}><Skeleton lines={8} /></div>;
  if (run.isError) {
    const notFound = run.error instanceof ApiError && run.error.status === 404;
    return (
      <div className={styles.runPage}>
        {notFound ? <EmptyState title="Run not found" message="It may belong to another account, or the link is wrong." action={<Button onClick={() => navigate("/")}>New run</Button>} /> : <ErrorBanner message={errorText(run.error)} onRetry={() => void run.refetch()} />}
      </div>
    );
  }
  if (latest === undefined) return null;
  return <RunThread key={thread[0]?.id} id={id} thread={thread} latest={latest} />;
}

function RunThread({ id, thread, latest }: { id: string; thread: RunView[]; latest: RunView }) {
  const navigate = useNavigate();
  const api = useApi();
  const session = useSession();
  const cancel = useCancelRun();
  const start = useStartRun();
  const refresh = useRunFinishedRefresh();
  const capabilities = useCapabilities();
  const apply = useApplyThread();
  const [followUp, setFollowUp] = useDraft(`followup:${session.data?.userId ?? "local"}:${thread[0]?.id ?? id}`);
  const [view, setView] = useState<"overview" | PanelTab>("overview");
  const [reviewTurnId, setReviewTurnId] = useState(latest.id);
  useEffect(() => { setView("overview"); setReviewTurnId(latest.id); }, [latest.id]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // One stream for the latest turn, shared by its step list and the budget panel.
  const latestId = latest.id;
  const live = useRunEvents(latest.status === "queued" ? null : api.eventsUrl(latestId), { onFinished: () => refresh(latestId) });

  const root = thread[0] ?? latest;
  const active = isActive(latest.status);
  const folder = root.request.repo.kind === "local" ? root.request.repo.path : null;
  const finished = thread.filter((turn) => isTerminal(turn.status));
  const canApply = capabilities.canApply && folder !== null && !active && finished.some((turn) => turn.changedFiles.length > 0);
  const applyOutcome = apply.data === undefined ? null : apply.data.ok ? apply.data : { ok: false as const, turn: apply.data.turn, turns: finished.length, result: apply.data.result };
  const login = session.data?.login ?? "You";

  const sendFollowUp = () => {
    start.mutate(
      { parentRunId: latest.id, task: followUp.trim(), ...(latest.request.verificationCommands === undefined ? {} : { verificationCommands: latest.request.verificationCommands }) },
      {
        onSuccess: (child) => {
          setFollowUp("");
          navigate(`/runs/${child.id}`, { replace: true });
        },
      },
    );
  };

  return (
    <div className={styles.runPage}>
      <div className={styles.reviewWorkspace}>
        <RunHeader
          task={root.request.task}
          repoUrl={sourceUrl(root.request.repo)}
          sandbox={sandboxLabel(capabilities.sandbox, latest.request.network ?? "none")}
          {...(sourceRef(root.request.repo) === undefined ? {} : { gitRef: sourceRef(root.request.repo) as string })}
          model={latest.request.model ?? latest.request.provider}
          status={latest.status}
          {...(thread.length > 1 ? { statusDetail: `turn ${thread.length}` } : {})}
          actions={
            active ? (
              <Button variant="secondary" icon={<StopIcon size={16} />} onClick={() => { cancel.reset(); setConfirmCancel(true); }}>Cancel</Button>
            ) : (
              <>
                {latest.changedFiles.length > 0 ? <PatchButton runId={latest.id} /> : null}
                <Button variant="primary" onClick={() => setView("changes")}>Review changes</Button>
              </>
            )
          }
        />
        {applyOutcome === null || folder === null ? null : <div className={styles.applyNotice}><ApplyNotice outcome={applyOutcome} folder={folder} /></div>}
        {apply.error === null ? null : <ErrorBanner message={errorText(apply.error)} />}
        <div className={styles.reviewNav}><SegmentedControl<"overview" | PanelTab> label="Task view" value={view} onChange={setView} segments={[{value:"overview",label:"Overview"},{value:"changes",label:"Changes"},{value:"checks",label:"Checks"},{value:"budget",label:"Limits"}]} /></div>
        {view === "overview" ? <>
        {!active ? <TurnOutcome run={latest} detailed /> : null}
        <details key={active ? "working" : "finished"} className={styles.activity} open={active}>
          <summary>{active ? "Live activity" : `Activity · ${thread.length} turn${thread.length === 1 ? "" : "s"}`}</summary>
        <div className={styles.thread}>
          {thread.map((turn, index) => {
            const last = index === thread.length - 1;
            const open = last || expanded.has(turn.id) || turn.id === id;
            return (
              <TurnCard
                key={turn.id}
                userName={login}
                task={turn.request.task}
                createdAt={turn.createdAt}
                collapsed={!open}
                onExpand={() => setExpanded((current) => new Set(current).add(turn.id))}
                outcome={!last && isTerminal(turn.status) ? <TurnOutcome run={turn} detailed={open} /> : null}
              >
                {!open ? null : last ? <TurnStepsView run={turn} state={live.state} stream={live.stream} /> : <TurnSteps run={turn} />}
              </TurnCard>
            );
          })}
        </div>
        </details>
        </> : <>
          {finished.length > 1 ? <SelectField label="Review turn" value={reviewTurnId} onChange={event => setReviewTurnId(event.target.value)}>{thread.map((turn, index) => <option key={turn.id} value={turn.id}>Turn {index + 1}: {turn.request.task}</option>)}</SelectField> : null}
          <RunPanel key={`${reviewTurnId}-${view}`} run={thread.find(turn => turn.id === reviewTurnId) ?? latest} live={reviewTurnId === latest.id ? live.state : undefined} tab={view} />
          {canApply && view === "changes" ? <div className={styles.resultIntro}><p>Destination: <code>{folder}</code>. Applies {finished.length} completed turn{finished.length === 1 ? "" : "s"} in order. {finished.length > 1 ? "Review each turn using the selector above." : "Review the changes and checks before applying."} {finished.some(turn => turn.status !== "verified") ? "Some turns did not pass all final checks. Review their Checks before applying." : "Final checks passed for these turns."}</p><Button variant="primary" icon={<CheckIcon size={16} />} disabled={apply.isPending} onClick={() => apply.mutate(finished.map(turn => turn.id))}>{apply.isPending ? "Applying…" : finished.length > 1 ? "Apply all reviewed turns to my folder" : "Apply to my folder"}</Button></div> : null}
        </>}
        <div className={styles.followUp}>
          {start.error === null ? null : <ErrorBanner message={errorText(start.error)} />}
          <FollowUpComposer
            value={followUp}
            onChange={setFollowUp}
            onSubmit={sendFollowUp}
            busy={start.isPending}
            running={active}
            onStop={() => { cancel.reset(); setConfirmCancel(true); }}
            {...(latest.status === "cancelled" || latest.status === "failed" && latest.summary === null ? { disabledReason: "This run ended without a result to build on. Start a new run instead." } : {})}
          />
        </div>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this run?"
        message="Caramel stops at the next safe point. Work in progress is discarded and no patch is kept."
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        busy={cancel.isPending}
        {...(cancel.error ? { error: errorText(cancel.error) } : {})}
        onConfirm={() => cancel.mutate(latest.id, { onSuccess: () => setConfirmCancel(false) })}
      />
    </div>
  );
}

function PatchButton({ runId }: { runId: string }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const download = async () => {
    setBusy(true);
    setFeedback("");
    try {
      downloadText(await api.getPatch(runId), `caramel-${runId}.patch`);
      setFeedback("Patch download requested. Check your browser’s downloads.");
    } catch (error) { setFeedback(errorText(error)); }
    finally { setBusy(false); }
  };
  return <div><Button variant="secondary" icon={<DownloadIcon size={16} />} disabled={busy} onClick={() => void download()}>{busy ? "Preparing patch…" : "Download this turn’s patch"}</Button><span role="status" className={styles.panelNote}>{feedback}</span></div>;
}

const STREAM_LABEL: Record<StreamStatus, string> = {
  idle: "",
  connecting: "Connecting…",
  open: "",
  reconnecting: "Connection dropped. Reconnecting…",
  closed: "Live updates stopped. Your task may still be running. Reload this page to reconnect.",
};

/** An earlier turn's steps, replayed from its event log when it is expanded. */
function TurnSteps({ run }: { run: RunView }) {
  const api = useApi();
  const { state, stream } = useRunEvents(run.status === "queued" ? null : api.eventsUrl(run.id));
  return <TurnStepsView run={run} state={state} stream={stream} />;
}

/** One turn's steps, streamed live while it runs and replayed from the log once it has finished. */
function TurnStepsView({ run, state, stream }: { run: RunView; state: LiveRunState; stream: StreamStatus }) {
  const queued = run.status === "queued";
  const live = isActive(run.status) && state.finishedAt === null && state.closedStatus === null;

  if (queued) return <WorkingBanner label="Queued. Your other run has to finish first." />;
  return (
    <div className={styles.steps}>
      {run.status === "preparing" && state.run.steps.length === 0 ? <WorkingBanner label="Cloning the repository and starting the sandbox…" trailing={<TypingDots />} /> : null}
      {!live || STREAM_LABEL[stream] === "" ? null : <div className={styles.streamNote} role="status">{STREAM_LABEL[stream]}{stream === "closed" ? <Button size="sm" onClick={() => window.location.reload()}>Reload updates</Button> : null}</div>}
      <StepTimeline steps={state.run.steps} outputs={state.stepOutputs} startedAt={state.stepStartedAt} rejections={state.run.rejections} live={live} />
      {live && state.run.steps.length > 0 && state.run.steps.at(-1)?.outcome !== undefined ? <WorkingBanner label="Thinking about the next step…" trailing={<TypingDots />} /> : null}
      {state.run.modelErrors.length === 0 ? null : (
        <details className={styles.modelErrors}>
          <summary>{state.run.modelErrors.length} model error{state.run.modelErrors.length === 1 ? "" : "s"} (retried)</summary>
          <ul>{state.run.modelErrors.map((error, index) => <li key={index}><code>{error.kind}</code> {error.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function TurnOutcome({ run, detailed }: { run: RunView; detailed: boolean }) {
  const result = useRunResult(run.id, detailed && isTerminal(run.status));
  const data = result.data;
  return (
    <OutcomeCard
      status={run.status}
      summary={data?.summary ?? run.summary}
      terminationReason={data?.terminationReason ?? run.terminationReason}
      changedFileCount={(data?.changedFiles ?? run.changedFiles).length}
      {...(data === undefined ? {} : { metrics: data.metrics, usage: data.usage })}
    />
  );
}

type PanelTab = "changes" | "checks" | "budget";

/** Right-hand panel for the latest turn: its diff, the checks behind its status, and its budget. */
function RunPanel({ run, live = INITIAL_LIVE_RUN, tab }: { run: RunView; live?: LiveRunState; tab: PanelTab }) {
  const done = isTerminal(run.status);
  const patch = usePatch(run.id, done && run.changedFiles.length > 0);
  const result = useRunResult(run.id, done);
  const files = useMemo(() => (patch.data === undefined ? [] : parseUnifiedDiff(patch.data)), [patch.data]);

  return (
    <SidePanel title={tab === "changes" ? "Review changes" : tab === "checks" ? "Final checks" : "Execution limits"}>
      {tab === "changes" ? (
        !done ? (
          <p className={styles.panelNote}>The diff appears when the run finishes.</p>
        ) : run.changedFiles.length === 0 ? (
          <p className={styles.panelNote}>This run changed no files.</p>
        ) : patch.isLoading ? (
          <Skeleton lines={4} />
        ) : patch.isError ? (
          <ErrorBanner message={errorText(patch.error)} onRetry={() => void patch.refetch()} />
        ) : (
          <>
            <PanelSection title={`Files (${files.length})`}>
              <ChangedFiles files={files} onSelect={(path) => document.getElementById(`diff-${path}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced" ? "instant" : "smooth", block: "start" })} />
            </PanelSection>
            <DiffView files={files} />
          </>
        )
      ) : null}
      {tab === "checks" ? (
        !done ? (
          <p className={styles.panelNote}>Checks are listed when the run finishes.</p>
        ) : result.isLoading ? (
          <Skeleton lines={3} />
        ) : result.isError ? (
          <ErrorBanner message={errorText(result.error)} onRetry={() => void result.refetch()} />
        ) : result.data === undefined ? (
          <p className={styles.panelNote}>No result was recorded for this run.</p>
        ) : (
          <EvidenceList evidence={result.data.verification.evidence} />
        )
      ) : null}
      {tab === "budget" ? <TurnBudget run={run} live={live} metrics={result.data?.metrics} /> : null}
    </SidePanel>
  );
}

function TurnBudget({ run, live, metrics }: { run: RunView; live: LiveRunState; metrics: { steps: number; modelCalls: number; durationMs: number } | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const active = isActive(run.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const budgets = live.budgets ?? run.request.budgets;
  const started = run.startedAt === null ? null : Date.parse(run.startedAt);
  const ended = run.finishedAt === null ? now : Date.parse(run.finishedAt);
  return (
    <BudgetMeters
      use={{
        steps: metrics?.steps ?? live.run.steps.length,
        maxSteps: budgets.maxSteps,
        elapsedMs: metrics?.durationMs ?? (started === null ? 0 : ended - started),
        maxMinutes: budgets.maxMinutes,
        modelCalls: metrics?.modelCalls ?? live.modelCalls,
        maxModelCalls: budgets.maxModelCalls,
      }}
    />
  );
}
