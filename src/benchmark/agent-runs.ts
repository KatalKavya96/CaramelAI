import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { runAutonomousTask, type AgentRunResult, type AgentStatus } from "../agent";
import { createSandboxedRunner, type SandboxChoice } from "../execution";
import type { ModelAdapter } from "../model";
import { hashDirectory } from "./hash";
import { loadBenchmarkManifest } from "./manifest";
import { evaluatePatch, materializeTaskSource } from "./runner";
import type { BenchmarkExecutor, BenchmarkManifest, BenchmarkOutcome, BenchmarkResult } from "./types";

/**
 * Runs the agent on benchmark tasks and scores each patch with the hidden evaluator, never with
 * the agent's own claims. Writes scorecard.json: the numbers the benchmark plan asks for.
 */

export type RunOutcome =
  | BenchmarkOutcome
  /** The model provider failed (rate limit, outage, bad key), not the agent. Left out of rates. */
  | "provider_error"
  /** Not started because the spending limit was reached. */
  | "skipped_budget";

export interface AgentRunRecord {
  taskId: string;
  split: BenchmarkManifest["split"];
  model: string;
  attempt: number;
  outcome: RunOutcome;
  agentStatus: AgentStatus | null;
  /** The agent finished with status "verified": it says its own checks passed. */
  claimedVerified: boolean;
  taskCheckPassed: boolean | null;
  regressionCheckPassed: boolean | null;
  terminationReason: string;
  durationMs: number;
  modelTimeMs: number;
  steps: number;
  modelCalls: number;
  tokens: { input: number; output: number; total: number; cachedInput: number };
  /** Dollars the provider reported; null when any call's cost was not reported. */
  costUsd: number | null;
  /** Folder with this run's agent output and evaluation, relative to the scorecard. */
  directory: string;
}

export interface ModelSummary {
  model: string;
  /** Runs that started, provider errors included. */
  attempted: number;
  providerErrors: number;
  /** Runs that count toward rates: attempted minus provider errors. */
  scored: number;
  solved: number;
  /** solved / scored. */
  solveRate: number | null;
  solveRateBySplit: { development: number | null; heldOut: number | null };
  verifiedClaims: number;
  /** Verified claims the evaluator did not score as solved. */
  falseSuccesses: number;
  /** falseSuccesses / verifiedClaims: when the agent says "verified", how often it is wrong. */
  falseSuccessRate: number | null;
  /** Runs whose task check passed but a regression check failed: fixed one thing, broke another. */
  regressions: number;
  regressionRate: number | null;
  costUsd: number;
  /** False when some calls did not report cost, so costUsd is a lower bound. */
  costComplete: boolean;
  costPerSolvedUsd: number | null;
  tokensPerSolved: number | null;
  durationPerSolvedMs: number | null;
  /** Time waiting on the model / total run time. */
  modelTimeShare: number | null;
  /** Cached input tokens / all input tokens. */
  cacheHitShare: number | null;
  perTask: { taskId: string; split: BenchmarkManifest["split"]; attempts: number; solved: number }[];
}

export interface Scorecard {
  schemaVersion: 1;
  recordedAt: string;
  harnessRevision: string | null;
  taskSetSha256: string;
  provider: string;
  repeats: number;
  maxCostUsd: number | null;
  /** Why the benchmark stopped before every run started, if it did. */
  stoppedEarly: string | null;
  models: ModelSummary[];
  runs: AgentRunRecord[];
}

export interface AgentBenchmarkOptions {
  tasksRoot: string;
  taskIds: readonly string[];
  provider: string;
  models: readonly string[];
  repeats: number;
  outputPath: string;
  /** Stop starting runs once the reported spend reaches this. */
  maxCostUsd?: number;
  /** Where the agent's commands and the hidden checks run. */
  sandbox?: SandboxChoice;
}

export interface AgentBenchmarkDependencies {
  createModel: (model: string) => ModelAdapter;
  runAgent?: typeof runAutonomousTask;
  evaluate?: typeof evaluatePatch;
  /** Runs the hidden checks. Defaults to the sandbox chosen in the options. */
  evaluatorExecutor?: (workspacePath: string, evaluatorPath: string, outputPath: string) => Promise<BenchmarkExecutor>;
  log?: (line: string) => void;
  now?: () => Date;
  harnessRevision?: string | null;
}

const PROVIDER_FAILURE = /^Model error \((rate_limit|transport|authentication|budget_exhausted)\)/;

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Hidden checks in the OS sandbox or Docker, with no network, like the agent's own commands. */
export function sandboxedEvaluator(choice: SandboxChoice) {
  return async (workspacePath: string, _evaluatorPath: string, outputPath: string): Promise<BenchmarkExecutor> => {
    const runner = await createSandboxedRunner(choice, { workspacePath, logsPath: resolve(outputPath, "logs"), network: "none" });
    return { run: (command, timeoutMs, env) => runner.run({ command, timeoutMs, env, purpose: "verification" }) };
  };
}

function check(result: BenchmarkResult | null, kind: "task" | "regression"): boolean | null {
  const checks = result?.checks.filter((item) => item.kind === kind) ?? [];
  return checks.length === 0 ? null : checks.every(({ passed }) => passed);
}

function outcomeOf(agent: AgentRunResult, evaluation: BenchmarkResult): RunOutcome {
  if (agent.changedFiles.length === 0 && PROVIDER_FAILURE.test(agent.terminationReason)) return "provider_error";
  return evaluation.outcome;
}

export function summarize(runs: readonly AgentRunRecord[], model: string): ModelSummary {
  const mine = runs.filter((run) => run.model === model && run.outcome !== "skipped_budget");
  const scored = mine.filter((run) => run.outcome !== "provider_error");
  const solved = scored.filter((run) => run.outcome === "solved");
  const claims = scored.filter((run) => run.claimedVerified);
  const taskPassed = scored.filter((run) => run.taskCheckPassed === true);
  const bySplit = (split: BenchmarkManifest["split"]) => {
    const inSplit = scored.filter((run) => run.split === split);
    return ratio(inSplit.filter((run) => run.outcome === "solved").length, inSplit.length);
  };
  const sum = (pick: (run: AgentRunRecord) => number) => mine.reduce((total, run) => total + pick(run), 0);
  const costUsd = sum((run) => run.costUsd ?? 0);
  const costComplete = mine.every((run) => run.costUsd !== null);
  const input = sum((run) => run.tokens.input);
  const tasks = new Map<string, ModelSummary["perTask"][number]>();
  for (const run of scored) {
    const entry = tasks.get(run.taskId) ?? { taskId: run.taskId, split: run.split, attempts: 0, solved: 0 };
    entry.attempts += 1;
    if (run.outcome === "solved") entry.solved += 1;
    tasks.set(run.taskId, entry);
  }
  return {
    model,
    attempted: mine.length,
    providerErrors: mine.length - scored.length,
    scored: scored.length,
    solved: solved.length,
    solveRate: ratio(solved.length, scored.length),
    solveRateBySplit: { development: bySplit("development"), heldOut: bySplit("held_out") },
    verifiedClaims: claims.length,
    falseSuccesses: claims.filter((run) => run.outcome !== "solved").length,
    falseSuccessRate: ratio(claims.filter((run) => run.outcome !== "solved").length, claims.length),
    regressions: taskPassed.filter((run) => run.regressionCheckPassed === false).length,
    regressionRate: ratio(taskPassed.filter((run) => run.regressionCheckPassed === false).length, taskPassed.length),
    costUsd,
    costComplete,
    // Everything spent, failures included, per solved task: a cheap model that fails costs the retry.
    costPerSolvedUsd: costComplete ? ratio(costUsd, solved.length) : null,
    tokensPerSolved: ratio(sum((run) => run.tokens.total), solved.length),
    durationPerSolvedMs: ratio(sum((run) => run.durationMs), solved.length),
    modelTimeShare: ratio(sum((run) => run.modelTimeMs), sum((run) => run.durationMs)),
    cacheHitShare: ratio(sum((run) => run.tokens.cachedInput), input),
    perTask: [...tasks.values()],
  };
}

export async function runAgentBenchmark(options: AgentBenchmarkOptions, dependencies: AgentBenchmarkDependencies): Promise<Scorecard> {
  if (!Number.isInteger(options.repeats) || options.repeats <= 0) throw new Error("repeats must be a positive integer.");
  if (options.models.length === 0 || options.taskIds.length === 0) throw new Error("Pick at least one model and one task.");
  const runAgent = dependencies.runAgent ?? runAutonomousTask;
  const evaluate = dependencies.evaluate ?? evaluatePatch;
  const evaluatorExecutor = dependencies.evaluatorExecutor ?? sandboxedEvaluator(options.sandbox ?? "auto");
  const log = dependencies.log ?? (() => {});
  const now = dependencies.now ?? (() => new Date());
  const outputPath = resolve(options.outputPath);
  await mkdir(outputPath, { recursive: true });

  const manifests = new Map<string, BenchmarkManifest>();
  for (const id of options.taskIds) manifests.set(id, await loadBenchmarkManifest(join(options.tasksRoot, id)));

  const runs: AgentRunRecord[] = [];
  let spentUsd = 0;
  let stoppedEarly: string | null = null;
  const total = options.repeats * options.taskIds.length * options.models.length;

  // Attempt, then task, then model: if the spending limit stops the benchmark early, every model
  // has had the same tasks so far, which keeps the comparison fair.
  for (let attempt = 1; attempt <= options.repeats; attempt += 1) {
    for (const taskId of options.taskIds) {
      const manifest = manifests.get(taskId)!;
      for (const model of options.models) {
        const directory = join(outputPath, taskId, model.replaceAll(/[^A-Za-z0-9._-]+/g, "_"), `attempt-${attempt}`);
        const base = { taskId, split: manifest.split, model, attempt, directory: relative(outputPath, directory) };
        if (stoppedEarly === null && options.maxCostUsd !== undefined && spentUsd >= options.maxCostUsd) {
          stoppedEarly = `Spending limit of $${options.maxCostUsd.toFixed(2)} reached after $${spentUsd.toFixed(4)}.`;
        }
        if (stoppedEarly !== null) {
          runs.push({
            ...base, outcome: "skipped_budget", agentStatus: null, claimedVerified: false, taskCheckPassed: null,
            regressionCheckPassed: null, terminationReason: stoppedEarly, durationMs: 0, modelTimeMs: 0, steps: 0,
            modelCalls: 0, tokens: { input: 0, output: 0, total: 0, cachedInput: 0 }, costUsd: null,
          });
          continue;
        }

        log(`[${runs.length + 1}/${total}] ${taskId} · ${model} · attempt ${attempt}`);
        const taskRoot = join(options.tasksRoot, taskId);
        const repoPath = join(directory, "repo");
        await mkdir(directory, { recursive: true });
        await materializeTaskSource(taskRoot, repoPath);
        const agent = await runAgent({
          repoPath,
          outputPath: join(directory, "agent"),
          task: manifest.issue,
          maxSteps: manifest.budget.maxSteps,
          maxMinutes: manifest.budget.maxMinutes,
          maxModelCalls: manifest.budget.maxModelCalls,
          commandNetwork: "none",
          sandbox: options.sandbox ?? "auto",
        }, { model: dependencies.createModel(model) });
        const patch = await readFile(agent.patchPath, "utf8").catch(() => "");
        const evaluation = await evaluate({
          taskRoot,
          patch,
          outputPath: join(directory, "evaluation"),
          executorFactory: evaluatorExecutor,
        });

        const usage = agent.usage;
        const costUsd = usage.costUnknownCalls > 0 || usage.estimatedTotalTokens > 0 || usage.unavailableCalls > 0 ? null : usage.providerCostUsd;
        spentUsd += usage.providerCostUsd;
        const record: AgentRunRecord = {
          ...base,
          outcome: outcomeOf(agent, evaluation),
          agentStatus: agent.status,
          claimedVerified: agent.status === "verified",
          taskCheckPassed: check(evaluation, "task"),
          regressionCheckPassed: check(evaluation, "regression"),
          terminationReason: agent.terminationReason,
          durationMs: agent.metrics.durationMs,
          modelTimeMs: usage.modelTimeMs,
          steps: agent.metrics.steps,
          modelCalls: agent.metrics.modelCalls,
          tokens: {
            input: usage.providerInputTokens + usage.estimatedInputTokens,
            output: usage.providerOutputTokens + usage.estimatedOutputTokens,
            total: usage.providerTotalTokens + usage.estimatedTotalTokens,
            cachedInput: usage.cachedInputTokens,
          },
          costUsd,
        };
        runs.push(record);
        log(`  ${record.outcome}${record.claimedVerified ? " (agent said verified)" : ""} · ${record.tokens.total} tokens` +
          `${costUsd === null ? "" : ` · $${costUsd.toFixed(4)}`} · total so far $${spentUsd.toFixed(4)}`);
        if (options.maxCostUsd !== undefined && costUsd === null && stoppedEarly === null) {
          stoppedEarly = "This provider did not report cost, so the spending limit cannot be enforced.";
        }
      }
    }
  }

  const scorecard: Scorecard = {
    schemaVersion: 1,
    recordedAt: now().toISOString(),
    harnessRevision: dependencies.harnessRevision ?? null,
    taskSetSha256: await hashDirectory(options.tasksRoot),
    provider: options.provider,
    repeats: options.repeats,
    maxCostUsd: options.maxCostUsd ?? null,
    stoppedEarly,
    models: options.models.map((model) => summarize(runs, model)),
    runs,
  };
  await writeFile(join(outputPath, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
  return scorecard;
}
