import { z } from "zod";
import { DEFAULT_BUDGETS } from "../config";

/**
 * Where the repository comes from. A shared server accepts only `git`: a path typed into a
 * request would let one user point the harness at any folder on the host.
 */
export const RepoSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    path: z.string().trim().min(1).refine((path) => path.startsWith("/"), "Local paths must be absolute."),
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
  provider: z.enum(["openrouter", "deepseek", "qwen"]),
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
}

export const SHARED_SERVER_POLICY: RunRequestPolicy = {
  allowLocalRepos: false,
  allowedGitHosts: ["github.com"],
  ceilings: { maxSteps: 120, maxMinutes: 30, maxModelCalls: 80 },
  commandNetwork: "none",
  allowRunNetwork: false,
  sandbox: "docker",
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
  if (request.repo.kind === "local" && !policy.allowLocalRepos) {
    issues.push("repo: this server accepts only git URLs, not local paths.");
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
