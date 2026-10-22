import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
import { parseRunRequest, RunRequestError, type RunRequest, type RunRequestPolicy } from "./run-request";

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
}

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
        const record = JSON.parse(await readFile(resolve(options.runsRoot, entry.name, "run.json"), "utf8")) as RunRecord;
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

  async start(ownerId: string, input: unknown): Promise<RunRecord> {
    const request = parseRunRequest(input, this.options.policy);
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
    };
    await mkdir(this.runDir(record.id));
    await this.update(record, {});
    this.records.set(record.id, record);
    this.live.set(record.id, { controller: new AbortController(), listeners: new Set() });
    this.queue.push(record.id);
    this.pump();
    return structuredClone(record);
  }

  /** Another user's run looks exactly like a missing one, so ids cannot be probed. */
  get(ownerId: string, id: string): RunRecord {
    const record = this.records.get(id);
    if (record === undefined || record.ownerId !== ownerId) throw new RunNotFoundError();
    return structuredClone(record);
  }

  list(ownerId: string): RunRecord[] {
    return [...this.records.values()]
      .filter((run) => run.ownerId === ownerId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((run) => structuredClone(run));
  }

  async cancel(ownerId: string, id: string): Promise<RunRecord> {
    const record = this.records.get(id);
    if (record === undefined || record.ownerId !== ownerId) throw new RunNotFoundError();
    if (record.status === "queued") {
      this.queue.splice(this.queue.indexOf(id), 1);
      await this.update(record, { status: "cancelled", terminationReason: "Cancelled before it started.", finishedAt: this.now().toISOString() });
      this.live.delete(id);
    } else {
      this.live.get(id)?.controller.abort();
    }
    return structuredClone(record);
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
      const repoPath = await (this.options.prepareRepository ?? prepareRepository)(
        record.request.repo,
        resolve(this.runDir(record.id), "repo"),
        signal,
      );
      if (signal.aborted) throw new Error("Cancelled while preparing the repository.");
      await this.update(record, { status: "running" });
      const result: AgentRunResult = await (this.options.runTask ?? runAutonomousTask)(
        {
          repoPath,
          outputPath: resolve(this.runDir(record.id), "output"),
          task: record.request.task,
          maxSteps: record.request.budgets.maxSteps,
          maxMinutes: record.request.budgets.maxMinutes,
          maxModelCalls: record.request.budgets.maxModelCalls,
          commandNetwork: this.options.policy.commandNetwork,
          ...(record.request.verificationCommands === undefined ? {} : { verificationCommands: record.request.verificationCommands }),
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
