import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SANDBOX_CHOICES, type SandboxChoice } from "../execution";
import { credentialFromEnv, isProvider, PROVIDER_INFO } from "../model/providers";
import { runAgentBenchmark } from "./agent-runs";
import { renderBenchmarkDashboard } from "./dashboard";
import { evaluatePatch, readPatch } from "./runner";

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing required ${name} option.`);
  return value;
}

function optional(args: readonly string[], name: string): string | undefined {
  return args.includes(name) ? option(args, name) : undefined;
}

const USAGE = [
  "Usage: benchmark evaluate --task <directory> --patch <file> --output <directory>",
  "       benchmark report --input <report.json> [--comparison <report.json>]",
  "       benchmark agent --output <directory> [--tasks a,b] [--provider openrouter] --models m1,m2",
  "                       [--repeats 1] [--max-cost <dollars>] [--sandbox auto|native|docker]",
  "",
  "agent runs the real agent on each task and scores it with the hidden checks. The provider key is",
  "read from its environment variable (AI_API_KEY for OpenRouter).",
].join("\n");

async function runAgentCommand(args: readonly string[], env: Record<string, string | undefined>): Promise<number> {
  const tasksRoot = resolve(import.meta.dir, "../../benchmarks/tasks");
  const provider = optional(args, "--provider") ?? "openrouter";
  if (!isProvider(provider)) throw new Error(`Unknown provider: ${provider}`);
  const info = PROVIDER_INFO[provider];
  const apiKey = credentialFromEnv(provider, env);
  if (apiKey === undefined) throw new Error(provider === "custom" ? "Set CUSTOM_BASE_URL (and CUSTOM_API_KEY if it needs one) first." : `Set ${info.keyEnv} to your ${info.label} key first.`);
  // No default model: a benchmark spends money per run, so which models it pays for is always the user's choice.
  if (optional(args, "--models") === undefined) throw new Error("Name the models to compare with --models, e.g. --models qwen/qwen3-coder:free. On OpenRouter, ids ending in :free cost nothing.");
  const sandbox = optional(args, "--sandbox") ?? "auto";
  if (!SANDBOX_CHOICES.includes(sandbox as SandboxChoice)) throw new Error(`--sandbox must be one of: ${SANDBOX_CHOICES.join(", ")}`);
  const list = (value: string | undefined) => value?.split(",").map((item) => item.trim()).filter((item) => item !== "");
  const taskIds = list(optional(args, "--tasks")) ??
    (await readdir(tasksRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const maxCost = optional(args, "--max-cost");
  const maxCostUsd = maxCost === undefined ? undefined : Number(maxCost);
  if (maxCostUsd !== undefined && !(maxCostUsd > 0)) throw new Error("--max-cost must be a positive number of dollars.");
  if (maxCostUsd !== undefined && !info.reportsCost) {
    throw new Error(`${info.label} does not report cost, so --max-cost cannot be enforced. Set a limit in its dashboard instead.`);
  }
  const revision = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: tasksRoot, stderr: "ignore" });

  const scorecard = await runAgentBenchmark({
    tasksRoot,
    taskIds,
    provider,
    models: list(option(args, "--models")) ?? [],
    repeats: Number(optional(args, "--repeats") ?? "1"),
    outputPath: option(args, "--output"),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    sandbox: sandbox as SandboxChoice,
  }, {
    createModel: (model) => info.create({ apiKey, model }),
    log: (line) => console.log(line),
    harnessRevision: revision.exitCode === 0 ? revision.stdout.toString().trim() : null,
  });
  const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
  for (const summary of scorecard.models) {
    console.log(`\n${summary.model}: solved ${summary.solved}/${summary.scored}` +
      ` · false success ${percent(summary.falseSuccessRate)} · $${summary.costUsd.toFixed(4)}${summary.costComplete ? "" : " (at least)"}` +
      (summary.providerErrors > 0 ? ` · ${summary.providerErrors} provider errors` : ""));
  }
  if (scorecard.stoppedEarly !== null) console.log(`\nStopped early: ${scorecard.stoppedEarly}`);
  console.log(`\nScorecard: ${resolve(option(args, "--output"), "scorecard.json")}`);
  return 0;
}

export async function runBenchmarkCli(args = Bun.argv.slice(2), env: Record<string, string | undefined> = Bun.env): Promise<number> {
  try {
    if (args[0] === "agent") return await runAgentCommand(args, env);
    if (args[0] === "report") {
      const report = JSON.parse(await readFile(resolve(option(args, "--input")), "utf8"));
      const comparisonIndex = args.indexOf("--comparison");
      const comparison = comparisonIndex < 0
        ? undefined
        : JSON.parse(await readFile(resolve(option(args, "--comparison")), "utf8"));
      console.log(renderBenchmarkDashboard(report, comparison));
      return 0;
    }
    if (args[0] !== "evaluate") {
      throw new Error(USAGE);
    }
    const taskRoot = option(args, "--task");
    const patchPath = option(args, "--patch");
    const outputPath = option(args, "--output");
    await mkdir(resolve(outputPath, ".."), { recursive: true });
    const result = await evaluatePatch({ taskRoot, patch: await readPatch(patchPath), outputPath });
    console.log(JSON.stringify(result, null, 2));
    return result.outcome === "solved" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (import.meta.main) process.exitCode = await runBenchmarkCli();
