import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  runAutonomousTask,
  type AgentEvent,
  type AgentRunResult,
  type AgentStatus,
  type AutonomousRunDependencies,
} from "../agent";
import type { ModelAdapter } from "../model";
import { prepareRepository } from "./repo-source";
import {
  FollowUpRequestSchema,
  parseRunRequest,
  RunRequestError,
  type RunRequest,
  type RunRequestPolicy,
} from "./run-request";

export type RunRecordStatus = "queued" | "preparing" | "running" | AgentStatus;

/** What the service persists about a run in `<runsRoot>/<id>/run.json`. */
export interface RunRecord {
  id: string;
  ownerId: string;
  request: RunRequest;
  status: RunRecordStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Why the run ended, including failures before the agent started (clone, workspace). */
  terminationReason: string | null;
  changedFiles: string[];
  /** The agent's own summary of what it did; a follow-up run is given it as context. */
  summary: string | null;
  /** The run this one continues from, or null for a fresh run. */
  parentRunId: string | null;
}

/** A run as a client sees it: the record plus the follow-ups made from it, newest first. */
export type RunView = RunRecord & { childRunIds: string[] };

export class RunNotFoundError extends Error {
  constructor() {
    super("Run not found.");
    this.name = "RunNotFoundError";
  }
}

export class RunLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunLimitError";
  }
}

export interface RunServiceOptions {
  runsRoot: string;
  policy: RunRequestPolicy;
  /** Runs executing at once across all users. */
  maxConcurrentRuns: number;
  /** Queued plus running runs one user may have. */
  maxActiveRunsPerUser: number;
  createModel: (request: RunRequest) => ModelAdapter;
  createCommandExecutor?: AutonomousRunDependencies["createCommandExecutor"];
  /** Injected in tests; defaults to the real agent and git clone. */
  runTask?: typeof runAutonomousTask;
  prepareRepository?: typeof prepareRepository;
  now?: () => Date;
}

type Listener = (event: AgentEvent) => void;

interface LiveRun {
  controller: AbortController;
  listeners: Set<Listener>;
}

const ACTIVE: ReadonlySet<RunRecordStatus> = new Set(["queued", "preparing", "running"]);

/**
 * Owns every run: validation, ownership, the queue, cancellation and event fan-out. The HTTP
 * layer and the CLI are thin clients of this class, so the rules live in one place.
 */
export class RunService {
  private readonly records = new Map<string, RunRecord>();
  private readonly live = new Map<string, LiveRun>();
  private readonly queue: string[] = [];
  private running = 0;
  private readonly now: () => Date;

  private constructor(private readonly options: RunServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Loads persisted runs. A run that was active when the server stopped is marked failed. */
  static async open(options: RunServiceOptions): Promise<RunService> {
    const service = new RunService(options);
    await mkdir(options.runsRoot, { recursive: true });
    for (const entry of await readdir(options.runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const stored = JSON.parse(await readFile(resolve(options.runsRoot, entry.name, "run.json"), "utf8")) as RunRecord;
        // Records written before follow-ups existed lack these fields.
        const record: RunRecord = { ...stored, summary: stored.summary ?? null, parentRunId: stored.parentRunId ?? null };
        service.records.set(record.id, record);
        if (ACTIVE.has(record.status)) {
          await service.update(record, {
            status: "failed",
            terminationReason: "The server stopped while this run was active.",
            finishedAt: service.now().toISOString(),
          });
        }
      } catch {
        // A folder without a readable run.json is not a run this service created.
      }
    }
    return service;
  }

  /** Starts a fresh run, or a follow-up when the input names a parentRunId. */
  async start(ownerId: string, input: unknown): Promise<RunView> {
    const { request, parentRunId } = this.resolveRequest(ownerId, input);
    if (request.planMode) throw new RunRequestError(["planMode: plan mode is not available in the web service yet."]);
    const active = [...this.records.values()].filter((run) => run.ownerId === ownerId && ACTIVE.has(run.status));
    if (active.length >= this.options.maxActiveRunsPerUser) {
      throw new RunLimitError(`You already have ${active.length} active run(s); the limit is ${this.options.maxActiveRunsPerUser}.`);
    }
    const record: RunRecord = {
      id: crypto.randomUUID(),
      ownerId,
      request,
      status: "queued",
      createdAt: this.now().toISOString(),
      startedAt: null,
      finishedAt: null,
      terminationReason: null,
      changedFiles: [],
      summary: null,
      parentRunId,
    };
    await mkdir(this.runDir(record.id));
    await this.update(record, {});
    this.records.set(record.id, record);
    this.live.set(record.id, { controller: new AbortController(), listeners: new Set() });
    this.queue.push(record.id);
    this.pump();
    return this.view(record);
  }

  /** Another user's run looks exactly like a missing one, so ids cannot be probed. */
  get(ownerId: string, id: string): RunView {
    return this.view(this.owned(ownerId, id));
  }

  list(ownerId: string): RunView[] {
    return this.newestFirst([...this.records.values()].filter((run) => run.ownerId === ownerId))
      .map((run) => this.view(run));
  }

  async cancel(ownerId: string, id: string): Promise<RunView> {
    const record = this.owned(ownerId, id);
    if (record.status === "queued") {
      this.queue.splice(this.queue.indexOf(id), 1);
      await this.update(record, { status: "cancelled", terminationReason: "Cancelled before it started.", finishedAt: this.now().toISOString() });
      this.live.delete(id);
    } else {
      this.live.get(id)?.controller.abort();
    }
    return this.view(record);
  }

  /**
   * Sends every event after `afterSequence` (from events.jsonl), then live events. The listener
   * is registered before the file is read and duplicates are dropped by sequence, so an event
   * written during the read is delivered exactly once.
   */
  async subscribe(ownerId: string, id: string, afterSequence: number, listener: Listener): Promise<() => void> {
    this.get(ownerId, id);
    let delivered = afterSequence;
    const buffered: AgentEvent[] = [];
    let replaying = true;
    const forward = (event: AgentEvent) => {
      if (event.sequence <= delivered) return;
      delivered = event.sequence;
      listener(event);
    };
    const onLive: Listener = (event) => (replaying ? buffered.push(event) : forward(event));
    const live = this.live.get(id);
    live?.listeners.add(onLive);
    try {
      const text = await readFile(resolve(this.runDir(id), "output", "events.jsonl"), "utf8");
      for (const line of text.split("\n")) if (line.trim() !== "") forward(JSON.parse(line) as AgentEvent);
    } catch {
      // No events yet: the run is queued or still cloning.
    }
    replaying = false;
    buffered.splice(0).forEach(forward);
    return () => live?.listeners.delete(onLive);
  }

  private resolveRequest(ownerId: string, input: unknown): { request: RunRequest; parentRunId: string | null } {
    const isFollowUp = typeof input === "object" && input !== null && "parentRunId" in input;
    if (!isFollowUp) {
      const request = parseRunRequest(input, this.options.policy);
      if (request.planMode) throw new RunRequestError(["planMode: plan mode is not available in the web service yet."]);
      return { request, parentRunId: null };
    }
    const parsed = FollowUpRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new RunRequestError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`));
    }
    const parent = this.owned(ownerId, parsed.data.parentRunId);
    if (ACTIVE.has(parent.status)) throw new RunRequestError(["parentRunId: the parent run has not finished yet."]);
    const verificationCommands = parsed.data.verificationCommands ?? parent.request.verificationCommands;
    // Re-validated against the policy, so a follow-up cannot exceed limits the parent was held to.
    const request = parseRunRequest({
      task: parsed.data.task,
      repo: parent.request.repo,
      provider: parent.request.provider,
      ...(parent.request.model === undefined ? {} : { model: parent.request.model }),
      budgets: parsed.data.budgets,
      ...(verificationCommands === undefined ? {} : { verificationCommands }),
    }, this.options.policy);
    return { request, parentRunId: parent.id };
  }

  /** Another user's run looks exactly like a missing one, so ids cannot be probed. */
  private owned(ownerId: string, id: string): RunRecord {
    const record = this.records.get(id);
    if (record === undefined || record.ownerId !== ownerId) throw new RunNotFoundError();
    return record;
  }

  private view(record: RunRecord): RunView {
    const children = this.newestFirst([...this.records.values()].filter((run) => run.parentRunId === record.id));
    return { ...structuredClone(record), childRunIds: children.map((run) => run.id) };
  }

  private newestFirst(runs: RunRecord[]): RunRecord[] {
    return runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }

  /**
   * A follow-up starts from exactly where its parent ended: a clone of the parent's input
   * snapshot (its isolated git history) with the parent's final patch applied. The follow-up's
   * own patch is therefore incremental. The user's original repository is never touched.
   */
  private async prepareFromParent(parent: RunRecord, targetPath: string): Promise<string> {
    const output = resolve(this.runDir(parent.id), "output");
    await runGitOrThrow(["clone", "--quiet", "--no-hardlinks", resolve(output, "git"), targetPath], undefined, "Could not copy the parent run");
    const patchPath = resolve(output, "patch.diff");
    const hasPatch = await stat(patchPath).then((info) => info.size > 0, () => false);
    if (hasPatch) {
      await runGitOrThrow(["apply", "--binary", "--whitespace=nowarn", patchPath], targetPath, "The parent run's patch does not apply");
    }
    return targetPath;
  }

  private composeTask(record: RunRecord): string {
    if (record.parentRunId === null) return record.request.task;
    const parent = this.records.get(record.parentRunId)!;
    return [
      "This run continues an earlier run on the same repository. The workspace already contains that run's changes.",
      `Earlier task:\n${parent.request.task}`,
      `Earlier result (${parent.status}): ${parent.summary ?? parent.terminationReason ?? "no summary"}`,
      `New instruction from the user:\n${record.request.task}`,
    ].join("\n\n");
  }

  private runDir(id: string): string {
    return resolve(this.options.runsRoot, id);
  }

  private async update(record: RunRecord, changes: Partial<RunRecord>): Promise<void> {
    Object.assign(record, changes);
    await writeFile(resolve(this.runDir(record.id), "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  }

  private pump(): void {
    while (this.running < this.options.maxConcurrentRuns && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const record = this.records.get(id)!;
      this.running += 1;
      void this.execute(record).finally(() => {
        this.running -= 1;
        this.live.delete(id);
        this.pump();
      });
    }
  }

  private async execute(record: RunRecord): Promise<void> {
    const live = this.live.get(record.id)!;
    const signal = live.controller.signal;
    try {
      await this.update(record, { status: "preparing", startedAt: this.now().toISOString() });
      const target = resolve(this.runDir(record.id), "repo");
      const repoPath = record.parentRunId === null
        ? await (this.options.prepareRepository ?? prepareRepository)(record.request.repo, target, signal)
        : await this.prepareFromParent(this.records.get(record.parentRunId)!, target);
      if (signal.aborted) throw new Error("Cancelled while preparing the repository.");
      await this.update(record, { status: "running" });
      const result: AgentRunResult = await (this.options.runTask ?? runAutonomousTask)(
        {
          repoPath,
          outputPath: resolve(this.runDir(record.id), "output"),
          task: this.composeTask(record),
          maxSteps: record.request.budgets.maxSteps,
          maxMinutes: record.request.budgets.maxMinutes,
          maxModelCalls: record.request.budgets.maxModelCalls,
          commandNetwork: this.options.policy.commandNetwork,
          ...(record.request.verificationCommands === undefined ? {} : { verificationCommands: record.request.verificationCommands }),
          ...(record.parentRunId === null ? {} : { parentRunId: record.parentRunId }),
        },
        {
          model: this.options.createModel(record.request),
          runId: record.id,
          signal,
          onEvent: (event) => live.listeners.forEach((listener) => listener(event)),
          ...(this.options.createCommandExecutor === undefined ? {} : { createCommandExecutor: this.options.createCommandExecutor }),
        },
      );
      await this.update(record, {
        status: result.status,
        terminationReason: result.terminationReason,
        changedFiles: result.changedFiles,
        summary: result.summary,
        finishedAt: this.now().toISOString(),
      });
    } catch (error) {
      // Clone and workspace failures happen before the agent writes any event; they still end the run.
      await this.update(record, {
        status: signal.aborted ? "cancelled" : "failed",
        terminationReason: error instanceof Error ? error.message : String(error),
        finishedAt: this.now().toISOString(),
      });
    }
  }
}

async function runGitOrThrow(args: string[], cwd: string | undefined, failure: string): Promise<void> {
  const process = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`${failure}: ${stderr.trim() || `git exited ${exitCode}`}`);
}
