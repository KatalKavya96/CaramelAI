import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_BUDGETS } from "./config";
import { normalizeIssueUrl } from "./issue";
import {
  box,
  planQuestionToSelectChoices,
  renderPlanApproval,
  renderPlanSummary,
  renderSplash,
  type SelectChoice,
  type TerminalSelector,
} from "./tui";

export type TerminalPrompt = (question: string, defaultValue?: string) => string | null;

const PROVIDER_MODELS = {
  deepseek: ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"],
  qwen: ["qwen-plus", "qwen-max", "qwen-turbo"],
} as const;

const CUSTOM_REPOSITORY_VALUE = "__caramel_custom_repository_path__";

type InteractiveProvider = keyof typeof PROVIDER_MODELS;

export class InteractiveRunCancelled extends Error {
  constructor() {
    super("Interactive run cancelled.");
    this.name = "InteractiveRunCancelled";
  }
}

function answer(
  ask: TerminalPrompt,
  label: string,
  defaultValue?: string,
  required = false,
): string {
  const response = defaultValue === undefined ? ask(label) : ask(label, defaultValue);
  const value = response?.trim() ?? "";
  const resolved = value === "" ? defaultValue ?? "" : value;
  if (required && resolved === "") throw new Error(`${label} is required.`);
  return resolved;
}

function providerCredential(provider: InteractiveProvider): "DEEPSEEK_API_KEY" | "QWEN_API_KEY" {
  return provider === "deepseek" ? "DEEPSEEK_API_KEY" : "QWEN_API_KEY";
}

function defaultProvider(env: Record<string, string | undefined>): InteractiveProvider {
  if (env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
  if (env.QWEN_API_KEY?.trim()) return "qwen";
  return "deepseek";
}

function parseProvider(input: string): InteractiveProvider {
  return input.trim().toLowerCase() === "qwen" ? "qwen" : "deepseek";
}

function resolveModel(provider: InteractiveProvider, answerValue: string): string {
  const models = PROVIDER_MODELS[provider];
  const index = Number(answerValue);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) return models[index - 1] ?? models[0];
  return answerValue.trim() || models[0];
}

function cleanPath(input: string): string {
  return input.trim().replace(/^['"]|['"]$/g, "");
}

function expandPath(input: string, cwd: string): string {
  const cleaned = cleanPath(input);
  if (cleaned === "~") return homedir();
  if (cleaned.startsWith("~/")) return join(homedir(), cleaned.slice(2));
  return resolve(cwd, cleaned);
}

function isGitRepository(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, ".git"));
  } catch {
    return false;
  }
}

function nearestGitRepository(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (isGitRepository(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function childGitRepositories(root: string): string[] {
  try {
    if (!statSync(root).isDirectory()) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(root, entry.name))
      .filter(isGitRepository)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function discoverRepositoryChoices(cwd: string, env: Record<string, string | undefined> = process.env): string[] {
  const candidates = [
    nearestGitRepository(cwd),
    ...childGitRepositories(cwd),
    ...childGitRepositories(join(homedir(), "Desktop")),
    ...childGitRepositories(join(homedir(), "Documents")),
    ...(env.CARAMEL_REPO?.trim() ? [expandPath(env.CARAMEL_REPO, cwd)] : []),
  ].filter((value): value is string => value !== undefined);
  return [...new Set(candidates)].slice(0, 8);
}

function resolveRepositoryInput(input: string, choices: readonly string[], cwd: string): string {
  const selected = input.trim();
  const selectedIndex = Number(selected);
  const candidate = Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= choices.length
    ? choices[selectedIndex - 1]
    : expandPath(selected, cwd);
  if (candidate === undefined || !isGitRepository(candidate)) {
    throw new Error(`Repository must be a Git checkout. Could not use: ${candidate ?? input}`);
  }
  return candidate;
}

export function collectInteractiveRunArguments(options: {
  ask: TerminalPrompt;
  write?: (message: string) => void;
  cwd: string;
  env?: Record<string, string | undefined>;
  select?: TerminalSelector;
}): string[] {
  const write = options.write ?? console.log;
  const env = options.env ?? process.env;
  const color = env.NO_COLOR === undefined;

  write(renderSplash({ color }));
  answer(options.ask, "Continue", "Enter");

  write(box("Setup", [
    "Choose provider, model, repository, and GitHub issue.",
    "API keys stay in this terminal process and are never printed.",
    "Providers: DeepSeek and Qwen.",
  ], { color }));

  const repositoryChoices = discoverRepositoryChoices(options.cwd, env);
  const currentRepo = nearestGitRepository(options.cwd);
  const repoChoiceItems: SelectChoice[] = [
    ...repositoryChoices.map((repo) => ({
      label: repo,
      value: repo,
      ...(repo === currentRepo ? { hint: "current repo" } : {}),
    })),
    {
      label: "Paste custom repository path…",
      value: CUSTOM_REPOSITORY_VALUE,
      hint: "drag a folder or paste ~/path/to/repo",
    },
  ];
  let repo: string;
  if (repositoryChoices.length > 0 && options.select !== undefined) {
    const selectedRepo = options.select("Repository", repoChoiceItems, {
      defaultIndex: 0,
      help: "Use ↑/↓ or j/k. Press Enter to choose, or pick custom path.",
    });
    if (selectedRepo === CUSTOM_REPOSITORY_VALUE) {
      const customPath = answer(options.ask, "Repository path", options.cwd, true);
      repo = resolveRepositoryInput(customPath, repositoryChoices, options.cwd);
    } else {
      repo = resolveRepositoryInput(selectedRepo ?? repoChoiceItems[0]!.value, repositoryChoices, options.cwd);
    }
  } else {
    if (repositoryChoices.length > 0) {
      write(box("Repository", [
        "Choose a detected Git checkout by number, or paste/drag another path.",
        ...repositoryChoices.map((candidate, index) => `${index + 1}. ${candidate}`),
      ], { color }));
    } else {
      write(box("Repository", [
        "No nearby Git checkout was detected.",
        "Paste a path, use '.', or drag the repository folder into the terminal.",
      ], { color }));
    }
    const repoInput = answer(options.ask, "Repository number or path", repositoryChoices[0] === undefined ? options.cwd : "1", true);
    repo = resolveRepositoryInput(repoInput, repositoryChoices, options.cwd);
  }

  const providerChoices: SelectChoice[] = [
    { label: "DeepSeek", value: "deepseek", hint: "good default for coding runs" },
    { label: "Qwen", value: "qwen", hint: "OpenAI-compatible DashScope provider" },
  ];
  const defaultProviderValue = defaultProvider(env);
  const selectedProvider = options.select?.("Provider", providerChoices, {
    defaultIndex: providerChoices.findIndex((choice) => choice.value === defaultProviderValue),
    help: "Use ↑/↓ or j/k. Press Enter to choose the model provider.",
  }) ?? answer(options.ask, "Provider (deepseek/qwen)", defaultProviderValue);
  const provider = parseProvider(selectedProvider);

  const models = PROVIDER_MODELS[provider];
  const modelChoices: SelectChoice[] = models.map((model) => ({ label: model, value: model }));
  const selectedModel = options.select?.("Model", modelChoices, {
    defaultIndex: 0,
    help: "Use ↑/↓ or j/k. Press Enter to choose a model.",
  }) ?? answer(options.ask, "Model number or model id", models[0]);
  const model = resolveModel(provider, selectedModel);

  const credentialName = providerCredential(provider);
  if (!env[credentialName]?.trim()) {
    const key = answer(options.ask, credentialName, undefined, true);
    env[credentialName] = key;
  }

  const taskInput = answer(options.ask, "GitHub issue URL", undefined, true);
  const normalizedTaskInput = normalizeIssueUrl(taskInput);
  const repositoryMap = answer(options.ask, "Repository map (enabled/disabled)", "enabled");
  const maxSteps = answer(options.ask, "Maximum tool steps", String(DEFAULT_BUDGETS.maxSteps));
  const maxModelCalls = answer(options.ask, "Maximum model calls", String(DEFAULT_BUDGETS.maxModelCalls));
  const maxMinutes = answer(options.ask, "Maximum minutes", String(DEFAULT_BUDGETS.maxMinutes));
  const output = answer(options.ask, "Output directory (blank = automatic)");

  const modeChoices: SelectChoice[] = [
    { label: "Execute", value: "execute", hint: "run the agent immediately" },
    { label: "Plan", value: "plan", hint: "agent proposes a plan with questions first" },
  ];
  const selectedMode = options.select?.("Mode", modeChoices, {
    defaultIndex: 0,
    help: "Use ↑/↓ or j/k. Press Enter to choose execution mode.",
  }) ?? answer(options.ask, "Mode (execute/plan)", "execute");
  const planMode = selectedMode.trim().toLowerCase() === "plan";

  const taskArguments = normalizedTaskInput.startsWith("@")
    ? ["--task-file", normalizedTaskInput.slice(1)]
    : /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/.test(normalizedTaskInput)
      ? ["--issue", normalizedTaskInput]
      : ["--task", normalizedTaskInput];
  const argv = [
    "--repo", repo,
    ...taskArguments,
    "--provider", provider,
    "--model", model,
    "--repository-map", repositoryMap,
    "--max-steps", maxSteps,
    "--max-model-calls", maxModelCalls,
    "--max-minutes", maxMinutes,
    ...(provider === "deepseek" ? ["--reasoning-effort", "high"] : []),
    ...(planMode ? ["--plan", "enabled"] : []),
    ...(output === "" ? [] : ["--output", output]),
  ];

  write(box("Ready", [
    `Repository: ${repo}`,
    `Issue: ${normalizedTaskInput}`,
    `Provider: ${provider}`,
    `Model: ${model}`,
    `Repository map: ${repositoryMap}`,
    `Limits: ${maxSteps} steps, ${maxModelCalls} model calls, ${maxMinutes} minutes`,
    `Mode: ${planMode ? "Plan → Execute" : "Direct Execute"}`,
    `Output: ${output || "automatic temporary directory"}`,
    `API key: loaded from ${credentialName}`,
  ], { color }));

  const confirmation = answer(options.ask, "Start run? (Y/n)", "Y").toLowerCase();
  if (confirmation !== "y" && confirmation !== "yes") throw new InteractiveRunCancelled();
  return argv;
}
