import type { Capabilities, Provider } from "../lib/contract";

export interface Budgets {
  maxSteps: number;
  maxMinutes: number;
  maxModelCalls: number;
}

export interface BudgetPreset {
  id: "quick" | "standard" | "max";
  label: string;
  description: string;
  /** undefined means "let the server choose": its default, capped at its own ceilings. */
  budgets: Budgets | undefined;
}

/** Both servers' ceilings are at least 120 steps, 30 minutes and 80 model calls, so these always fit. */
export const BUDGET_PRESETS: BudgetPreset[] = [
  { id: "quick", label: "Quick", description: "40 steps · 10 min · 30 model calls", budgets: { maxSteps: 40, maxMinutes: 10, maxModelCalls: 30 } },
  { id: "standard", label: "Standard", description: "80 steps · 20 min · 50 model calls", budgets: { maxSteps: 80, maxMinutes: 20, maxModelCalls: 50 } },
  { id: "max", label: "Maximum", description: "Up to this server's limits", budgets: undefined },
];

export type RepoKind = "git" | "local";
export type NetworkChoice = "none" | "full";

export interface RunOptions {
  repoKind: RepoKind;
  repoUrl: string;
  gitRef: string;
  localPath: string;
  provider: Provider | null;
  model: string;
  preset: BudgetPreset["id"];
  checks: string[];
  network: NetworkChoice;
}

const GIT_URL = /^https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;

/** The server's own rules, checked early for a friendlier message: https git URLs, absolute local paths. */
export function repoError(options: Pick<RunOptions, "repoKind" | "repoUrl" | "localPath">, kinds: readonly RepoKind[]): string | null {
  if (!kinds.includes(options.repoKind)) return "This server cannot run on that kind of repository.";
  if (options.repoKind === "local") {
    const path = options.localPath.trim();
    if (path === "") return "Choose a folder to run in.";
    return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? null : "Use the folder's full path, starting with /.";
  }
  const url = options.repoUrl.trim();
  if (url === "") return "Add a repository to run against.";
  if (!GIT_URL.test(url)) return "Use an https git URL, like https://github.com/owner/repo.";
  if (!kinds.includes("local") && !url.startsWith("https://github.com/")) return "This server accepts GitHub repositories only.";
  return null;
}

const SANDBOX_NAMES: Record<string, string> = {
  seatbelt: "macOS sandbox",
  bubblewrap: "Linux sandbox",
  docker: "Docker sandbox",
};

/** "macOS sandbox · no network", from what the server reported and what this run asked for. */
export function sandboxLabel(sandbox: string, network: NetworkChoice): string {
  return `${SANDBOX_NAMES[sandbox] ?? `${sandbox} sandbox`} · ${network === "full" ? "network on" : "no network"}`;
}

/** The repository this run will use, for labels. */
export function repoDisplay(options: Pick<RunOptions, "repoKind" | "repoUrl" | "localPath">): string {
  return options.repoKind === "local" ? options.localPath : options.repoUrl;
}

export function defaultRunOptions(capabilities: Capabilities): RunOptions {
  return {
    repoKind: capabilities.repoKinds[0] ?? "git",
    repoUrl: "",
    gitRef: "",
    localPath: "",
    provider: null,
    model: "",
    preset: "standard",
    checks: [],
    network: capabilities.network.default,
  };
}
