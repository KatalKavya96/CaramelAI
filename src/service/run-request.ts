import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_BUDGETS } from "../config";
import { PROVIDERS } from "../model/providers";

/**
 * Where the repository comes from. A shared server accepts only `git`: a path typed into a
 * request would let one user point the harness at any folder on the host.
 */
export const RepoSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    // "~" is expanded by parseRunRequest on a server that has a home folder to expand it to.
    path: z.string().trim().min(1).max(4096).refine((path) => path.startsWith("/") || /^~(\/|$)/.test(path), "Local paths must be absolute or start with ~/."),
  }),
  z.object({
    kind: z.literal("git"),
    url: z.string().trim().url().refine((url) => url.startsWith("https://"), "Only https git URLs are accepted."),
    ref: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._\/-]+$/, "ref may contain only letters, digits, . _ / -").optional(),
  }),
]);

/** Omitted budgets are filled by parseRunRequest: the default, capped at the server's ceiling. */
export const RunBudgetsSchema = z.object({
  maxSteps: z.number().int().positive().optional(),
  maxMinutes: z.number().positive().optional(),
  maxModelCalls: z.number().int().positive().optional(),
});

/** What any client (CLI, HTTP, browser) sends to start a run. The single source for its shape. */
export const RunRequestSchema = z.object({
  task: z.string().trim().min(1, "task must not be empty.").max(20_000),
  repo: RepoSourceSchema,
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(200).optional(),
  budgets: RunBudgetsSchema.default({}),
  verificationCommands: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  planMode: z.boolean().default(false),
  /** Network for this run's commands. "full" only where the policy allows it. */
  network: z.enum(["none", "full"]).optional(),
});

/** Continues a finished run: repo, provider and model come from the parent. */
export const FollowUpRequestSchema = z.object({
  parentRunId: z.string().trim().min(1).max(100),
  task: z.string().trim().min(1, "task must not be empty.").max(20_000),
  budgets: RunBudgetsSchema.default({}),
  verificationCommands: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  network: z.enum(["none", "full"]).optional(),
});

export type FollowUpRequest = z.infer<typeof FollowUpRequestSchema>;
export type RepoSource = z.infer<typeof RepoSourceSchema>;
export type RunRequest = Omit<z.infer<typeof RunRequestSchema>, "budgets" | "network"> & {
  budgets: { maxSteps: number; maxMinutes: number; maxModelCalls: number };
  network: "none" | "full";
};

/** What the server allows, independent of what a client asks for. */
export interface RunRequestPolicy {
  /** False on a shared server: only git URLs are accepted. */
  allowLocalRepos: boolean;
  /** Hostnames a git URL may point at, e.g. ["github.com"]. */
  allowedGitHosts: readonly string[];
  ceilings: { maxSteps: number; maxMinutes: number; maxModelCalls: number };
  /** Network for target-repository commands when a request does not choose; "none" on a shared server. */
  commandNetwork: "bridge" | "none";
  /** Whether a request may turn the network on for its commands. */
  allowRunNetwork: boolean;
  /** Where commands run. A shared server uses Docker: OS sandboxes share one kernel and user between tenants. */
  sandbox: "auto" | "native" | "docker";
  /**
   * Whether the "custom" provider may be used. Off on a shared server: a user-chosen URL would make
   * the server send requests into its own network (server-side request forgery).
   */
  allowCustomEndpoint: boolean;
  /** Where "~" in a local path points. Only the desktop app has one: there, it is the user's own home. */
  homeDir: string | null;
}

/**
 * "~/code/app/" or "/Users/me/code/../code/app" -> "/Users/me/code/app": the form people type,
 * turned into the one path the run, the run list and Apply all agree on. "~other" is refused:
 * expanding another user's home is not something a run should do.
 */
export function normalizeLocalPath(path: string, homeDir: string | null): string | null {
  const trimmed = path.trim();
  let expanded = trimmed;
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    if (homeDir === null) return null;
    expanded = join(homeDir, trimmed.slice(1));
  }
  return isAbsolute(expanded) ? resolve(expanded) : null;
}

export const SHARED_SERVER_POLICY: RunRequestPolicy = {
  allowLocalRepos: false,
  allowedGitHosts: ["github.com"],
  ceilings: { maxSteps: 120, maxMinutes: 30, maxModelCalls: 80 },
  commandNetwork: "none",
  allowRunNetwork: false,
  sandbox: "docker",
  allowCustomEndpoint: false,
  homeDir: null,
};

/**
 * One person on their own machine: their folders, their network, their keys. Limits are a
 * safety net against runaway runs rather than a fair-share rule.
 */
export const LOCAL_APP_POLICY: RunRequestPolicy = {
  allowLocalRepos: true,
  allowedGitHosts: ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"],
  ceilings: { maxSteps: 300, maxMinutes: 120, maxModelCalls: 200 },
  commandNetwork: "none",
  allowRunNetwork: true,
  sandbox: "auto",
  allowCustomEndpoint: true,
  homeDir: homedir(),
};

export class RunRequestError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join(" "));
    this.name = "RunRequestError";
  }
}

/** Validates the shape, then the server policy. Throws RunRequestError listing every problem. */
export function parseRunRequest(input: unknown, policy: RunRequestPolicy): RunRequest {
  const parsed = RunRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new RunRequestError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`));
  }
  const issues: string[] = [];
  const budget = (key: "maxSteps" | "maxMinutes" | "maxModelCalls") =>
    parsed.data.budgets[key] ?? Math.min(DEFAULT_BUDGETS[key], policy.ceilings[key]);
  const request: RunRequest = {
    ...parsed.data,
    budgets: { maxSteps: budget("maxSteps"), maxMinutes: budget("maxMinutes"), maxModelCalls: budget("maxModelCalls") },
    network: parsed.data.network ?? (policy.commandNetwork === "bridge" ? "full" : "none"),
  };
  if (request.network === "full" && !policy.allowRunNetwork && policy.commandNetwork !== "bridge") {
    issues.push("network: this server runs commands without network access.");
  }
  if (request.provider === "custom" && !policy.allowCustomEndpoint) {
    issues.push("provider: custom endpoints are available only in the desktop app.");
  }
  if (request.repo.kind === "local" && !policy.allowLocalRepos) {
    issues.push("repo: this server accepts only git URLs, not local paths.");
  } else if (request.repo.kind === "local") {
    const normalized = normalizeLocalPath(request.repo.path, policy.homeDir);
    if (normalized === null) issues.push("repo.path: use the folder's full path, starting with / or ~/.");
    else request.repo = { kind: "local", path: normalized };
  }
  if (request.repo.kind === "git") {
    const url = new URL(request.repo.url);
    if (url.username !== "" || url.password !== "") issues.push("repo.url: credentials must not be embedded in the URL.");
    if (!policy.allowedGitHosts.includes(url.hostname)) {
      issues.push(`repo.url: host ${url.hostname} is not allowed (allowed: ${policy.allowedGitHosts.join(", ")}).`);
    }
  }
  for (const key of ["maxSteps", "maxMinutes", "maxModelCalls"] as const) {
    if (request.budgets[key] > policy.ceilings[key]) {
      issues.push(`budgets.${key}: ${request.budgets[key]} exceeds this server's limit of ${policy.ceilings[key]}.`);
    }
  }
  if (issues.length > 0) throw new RunRequestError(issues);
  return request;
}
