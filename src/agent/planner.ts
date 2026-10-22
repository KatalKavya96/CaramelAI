import { z } from "zod";
import type { ModelAdapter, ModelRequest, ResponseFormat } from "../model";
import { PLAN_SYSTEM_PROMPT } from "../prompts";
import { buildRepositoryMap, RepositoryTools } from "../tools";
import { parsePlanResponse, PlanResponseSchema } from "./plan-parser";
import type { AgentPlan, PlanQuestion } from "./types";

export { PLAN_SYSTEM_PROMPT } from "../prompts";
export {
  PlanQuestionSchema,
  PlanResponseSchema,
  parsePlanResponse,
  type PlanResponse,
} from "./plan-parser";

export function formatPlanContext(plan: AgentPlan): string {
  if (plan.answers.length === 0) return "";
  const lines = ["Plan context (user-approved decisions):"];
  for (const answer of plan.answers) {
    lines.push(`- ${answer.question}: ${answer.answer}${answer.isCustom ? " (custom)" : ""}`);
  }
  return lines.join("\n");
}

export interface GeneratedPlan {
  summary: string;
  questions: PlanQuestion[];
  /** Set when no plan could be produced, so the caller can say why instead of failing silently. */
  skippedReason?: string;
}

const PLAN_RESPONSE_FORMAT: ResponseFormat = {
  name: "caramel_plan",
  description: "A short plan summary and clarifying questions with options.",
  schema: (() => {
    const { $schema: _dialect, ...schema } = z.toJSONSchema(PlanResponseSchema, { io: "input" });
    return schema;
  })(),
};

/**
 * Plan mode goes through the same ModelAdapter as the run, so it gets the provider's base URL,
 * timeouts, retries and error mapping instead of a second hand-rolled HTTP client.
 */
export async function generatePlan(options: {
  model: ModelAdapter;
  task: string;
  repositoryContext: unknown;
  remainingTimeMs?: number;
}): Promise<GeneratedPlan> {
  const skipped = (reason: string): GeneratedPlan => ({
    summary: "Plan generation was skipped. Proceeding with direct execution.",
    questions: [],
    skippedReason: reason,
  });
  if (options.model.completeText === undefined) return skipped("The model does not support plan mode.");

  const request: ModelRequest = {
    messages: [
      { role: "system", content: PLAN_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ task: options.task, repository: options.repositoryContext }) },
    ],
    responseFormat: PLAN_RESPONSE_FORMAT,
  };
  try {
    const turn = await options.model.completeText(request, { remainingTimeMs: options.remainingTimeMs ?? 60_000 });
    return parsePlanResponse(turn.output);
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error));
  }
}

/**
 * What the planner sees of the repository: manifests, test setup and the files most related to the
 * task. Read-only and best-effort; a failure just yields a thinner context, never a failed run.
 */
export async function planRepositoryContext(repoPath: string, task: string): Promise<unknown> {
  try {
    const repository = await RepositoryTools.create(repoPath);
    const metadata = await repository.metadata();
    const map = await buildRepositoryMap({ repository, task }).catch(() => null);
    return {
      branch: metadata.ok ? metadata.value.branch : null,
      manifests: metadata.ok ? metadata.value.manifests : [],
      testConfigs: metadata.ok ? metadata.value.testConfigs : [],
      repositoryMap: map,
    };
  } catch {
    return {};
  }
}
