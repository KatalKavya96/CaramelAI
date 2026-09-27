import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { type IssueFetcher, formatIssueTask } from "./issue";

export const DEFAULT_BUDGETS = {
  maxSteps: 120,
  maxMinutes: 60,
  maxModelCalls: 80,
  maxRepairAttempts: 12,
  verificationReserveSteps: 10,
  maxStagnationInterventions: 6,
  maxContextChars: 64_000,
} as const;

export type DeepSeekReasoningEffort = "low" | "medium" | "high";

export interface RunConfig {
  repoPath: string;
  task: string;
  outputPath: string;
  apiKey?: string;
  provider: "openrouter" | "deepseek" | "qwen";
  model: string;
  reasoningEffort?: DeepSeekReasoningEffort;
  modelScriptPath?: string;
  planMode: boolean;
  repositoryMapEnabled: boolean;
  colorEnabled: boolean;
  budgets: {
    maxSteps: number;
    maxMinutes: number;
    maxModelCalls: number;
    maxRepairAttempts: number;
    verificationReserveSteps: number;
    maxStagnationInterventions: number;
    maxContextChars: number;
  };
}

export interface PublicRunConfig extends Omit<RunConfig, "apiKey"> {
  credentialConfigured: boolean;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

interface RunArguments {
  repo?: string;
  task?: string;
  taskFile?: string;
  issue?: string;
  output?: string;
  maxSteps?: string;
  maxMinutes?: string;
  maxModelCalls?: string;
  maxRepairAttempts?: string;
  verificationReserveSteps?: string;
  maxStagnationInterventions?: string;
  maxContextChars?: string;
  modelScript?: string;
  model?: string;
  reasoningEffort?: string;
  provider?: string;
  repositoryMap?: string;
  plan?: string;
  color?: string;
}

export interface LoadRunConfigOptions {
  argv: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  interactive?: boolean;
  promptForTask?: () => string | null;
  issueFetcher?: IssueFetcher;
}

const OPTION_NAMES = new Map<string, keyof RunArguments>([
  ["--repo", "repo"],
  ["--task", "task"],
  ["--task-file", "taskFile"],
  ["--issue", "issue"],
  ["--output", "output"],
  ["--max-steps", "maxSteps"],
  ["--max-minutes", "maxMinutes"],
  ["--max-model-calls", "maxModelCalls"],
  ["--max-repair-attempts", "maxRepairAttempts"],
  ["--verification-reserve-steps", "verificationReserveSteps"],
  ["--max-stagnation-interventions", "maxStagnationInterventions"],
  ["--max-context-chars", "maxContextChars"],
  ["--model-script", "modelScript"],
  ["--model", "model"],
  ["--reasoning-effort", "reasoningEffort"],
  ["--provider", "provider"],
  ["--repository-map", "repositoryMap"],
  ["--plan", "plan"],
  ["--color", "color"],
]);

function parseArguments(argv: string[]): RunArguments {
  const parsed: RunArguments = {};

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    const key = option === undefined ? undefined : OPTION_NAMES.get(option);

    if (key === undefined) {
      throw new ConfigurationError(`Unknown option: ${option ?? "<missing>"}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new ConfigurationError(`Option ${option} requires a value.`);
    }
    if (parsed[key] !== undefined) {
      throw new ConfigurationError(`Option ${option} may be supplied only once.`);
    }

    parsed[key] = value;
  }

  return parsed;
}

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive number.`);
  }
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = positiveNumber(value, fallback, name);
  if (!Number.isInteger(parsed)) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigurationError(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function validateRepository(repo: string | undefined, cwd: string): string {
  if (repo === undefined || repo.trim() === "") {
    throw new ConfigurationError("--repo is required.");
  }

  const repoPath = resolve(cwd, repo);
  if (!existsSync(repoPath)) {
    throw new ConfigurationError(`Repository does not exist: ${repoPath}`);
  }
  if (!statSync(repoPath).isDirectory()) {
    throw new ConfigurationError(`Repository path is not a directory: ${repoPath}`);
  }
  return repoPath;
}

function validateProvider(value: string | undefined, source: "--provider" | "MODEL_PROVIDER"): RunConfig["provider"] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const provider = value.trim();
  if (provider === "openrouter" || provider === "deepseek" || provider === "qwen") return provider;
  throw new ConfigurationError(`${source} must be openrouter, deepseek, or qwen.`);
}

function resolveProvider(args: RunArguments, env: Record<string, string | undefined>): RunConfig["provider"] {
  const cliProvider = validateProvider(args.provider, "--provider");
  if (cliProvider !== undefined) return cliProvider;

  const envProvider = validateProvider(env.MODEL_PROVIDER, "MODEL_PROVIDER");
  if (envProvider !== undefined) return envProvider;

  if (!env.AI_API_KEY?.trim() && env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
  if (!env.AI_API_KEY?.trim() && !env.DEEPSEEK_API_KEY?.trim() && env.QWEN_API_KEY?.trim()) return "qwen";
  return "openrouter";
}

function validateReasoningEffort(value: string | undefined): DeepSeekReasoningEffort | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const effort = value.trim();
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  throw new ConfigurationError("--reasoning-effort must be low, medium, or high.");
}

async function resolveTask(
  args: RunArguments,
  cwd: string,
  interactive: boolean,
  promptForTask?: () => string | null,
  issueFetcher?: IssueFetcher,
): Promise<string> {
  const suppliedTaskInputs = [args.task, args.taskFile, args.issue].filter((value) => value !== undefined);
  if (suppliedTaskInputs.length > 1) {
    throw new ConfigurationError("Use only one of --task, --task-file, or --issue.");
  }

  let task = args.task;
  if (args.taskFile !== undefined) {
    const taskPath = resolve(cwd, args.taskFile);
    try {
      task = await readFile(taskPath, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ConfigurationError(`Unable to read task file ${taskPath}: ${detail}`);
    }
  }
  if (args.issue !== undefined) {
    if (issueFetcher === undefined) {
      throw new ConfigurationError("--issue requires an issue fetcher in this process.");
    }
    task = formatIssueTask(await issueFetcher(args.issue));
  }

  if ((task === undefined || task.trim() === "") && interactive) {
    task = promptForTask?.() ?? undefined;
  }

  if (task === undefined || task.trim() === "") {
    throw new ConfigurationError(
      "A task is required. Pass --task or --task-file; interactive prompting is unavailable in this process.",
    );
  }
  return task.trim();
}

export async function loadRunConfig(options: LoadRunConfigOptions): Promise<RunConfig> {
  const args = parseArguments(options.argv);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const provider = resolveProvider(args, env);
  const reasoningEffort = validateReasoningEffort(args.reasoningEffort ?? env.DEEPSEEK_REASONING_EFFORT) ??
    (provider === "deepseek" ? "medium" : undefined);
  const credentialName = provider === "deepseek"
    ? "DEEPSEEK_API_KEY"
    : provider === "qwen"
      ? "QWEN_API_KEY"
      : "AI_API_KEY";
  const apiKey = env[credentialName]?.trim();

  if ((apiKey === undefined || apiKey === "") && args.modelScript === undefined) {
    throw new ConfigurationError(`${credentialName} is required for a ${provider} run.`);
  }

  const repoPath = validateRepository(args.repo, cwd);
  const task = await resolveTask(
    args,
    cwd,
    options.interactive ?? false,
    options.promptForTask,
    options.issueFetcher,
  );

  const config: RunConfig = {
    repoPath,
    task,
    provider,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    outputPath: resolve(
      cwd,
      args.output ?? resolve(tmpdir(), "dinner-runs", `run-${Date.now()}-${randomUUID()}`),
    ),
    model: args.model?.trim() || (provider === "deepseek"
      ? env.DEEPSEEK_MODEL?.trim() || "deepseek-flash"
      : provider === "qwen"
        ? env.QWEN_MODEL?.trim() || "qwen-plus"
        : env.OPENROUTER_MODEL?.trim() || "openai/gpt-5.2"),
    planMode: args.plan === "enabled" || args.plan === "true"
      ? true
      : args.plan === undefined || args.plan === "disabled" || args.plan === "false"
        ? false
        : (() => { throw new ConfigurationError("--plan must be enabled or disabled."); })(),
    repositoryMapEnabled: args.repositoryMap === undefined || args.repositoryMap === "disabled"
      ? false
      : args.repositoryMap === "enabled"
        ? true
        : (() => { throw new ConfigurationError("--repository-map must be enabled or disabled."); })(),
    colorEnabled: args.color === undefined
      ? env.NO_COLOR === undefined
      : args.color === "enabled"
        ? true
        : args.color === "disabled"
          ? false
          : (() => { throw new ConfigurationError("--color must be enabled or disabled."); })(),
    budgets: {
      maxSteps: positiveInteger(args.maxSteps, DEFAULT_BUDGETS.maxSteps, "--max-steps"),
      maxMinutes: positiveNumber(args.maxMinutes, DEFAULT_BUDGETS.maxMinutes, "--max-minutes"),
      maxModelCalls: positiveInteger(
        args.maxModelCalls,
        DEFAULT_BUDGETS.maxModelCalls,
        "--max-model-calls",
      ),
      maxRepairAttempts: positiveInteger(args.maxRepairAttempts, DEFAULT_BUDGETS.maxRepairAttempts, "--max-repair-attempts"),
      verificationReserveSteps: nonNegativeInteger(args.verificationReserveSteps, DEFAULT_BUDGETS.verificationReserveSteps, "--verification-reserve-steps"),
      maxStagnationInterventions: positiveInteger(args.maxStagnationInterventions, DEFAULT_BUDGETS.maxStagnationInterventions, "--max-stagnation-interventions"),
      maxContextChars: positiveInteger(args.maxContextChars, DEFAULT_BUDGETS.maxContextChars, "--max-context-chars"),
    },
  };
  if (config.budgets.verificationReserveSteps >= config.budgets.maxSteps) {
    throw new ConfigurationError("--verification-reserve-steps must be smaller than --max-steps.");
  }
  if (apiKey !== undefined && apiKey !== "") config.apiKey = apiKey;
  if (args.modelScript !== undefined) config.modelScriptPath = resolve(cwd, args.modelScript);
  return config;
}

export function toPublicRunConfig(config: RunConfig): PublicRunConfig {
  const { apiKey: _secret, ...safeConfig } = config;
  return { ...safeConfig, credentialConfigured: config.apiKey !== undefined };
}
