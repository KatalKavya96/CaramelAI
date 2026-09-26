import type { ModelAdapter, ModelRequest } from "../model";
import { PLAN_SYSTEM_PROMPT } from "../prompts";
import { parsePlanResponse } from "./plan-parser";
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

export async function generatePlan(options: {
  model: ModelAdapter;
  task: string;
  repositoryContext: unknown;
  remainingTimeMs?: number;
}): Promise<{ summary: string; questions: PlanQuestion[] }> {
  const request: ModelRequest = {
    messages: [
      { role: "system", content: PLAN_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          task: options.task,
          repository: options.repositoryContext,
        }),
      },
    ],
  };

  try {
    const turn = await options.model.complete(request, {
      remainingTimeMs: options.remainingTimeMs ?? 60_000,
    });
    const output = JSON.stringify(turn.decision);
    return parsePlanResponse(output);
  } catch {
    return {
      summary: "Plan generation was skipped. Proceeding with direct execution.",
      questions: [],
    };
  }
}

export async function generatePlanRaw(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  task: string;
  repositoryContext: unknown;
}): Promise<{ summary: string; questions: PlanQuestion[] }> {
  try {
    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: PLAN_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              task: options.task,
              repository: options.repositoryContext,
            }),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.0,
        stream: false,
      }),
    });

    if (!response.ok) {
      return { summary: "Plan generation failed — proceeding with direct execution.", questions: [] };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      return { summary: "No plan generated — proceeding with direct execution.", questions: [] };
    }

    return parsePlanResponse(content);
  } catch {
    return { summary: "Plan generation was skipped. Proceeding with direct execution.", questions: [] };
  }
}
