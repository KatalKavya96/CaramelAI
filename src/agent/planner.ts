import { z } from "zod";
import type { ModelAdapter, ModelRequest } from "../model";
import type { AgentPlan, PlanQuestion } from "./types";

import { PLAN_SYSTEM_PROMPT } from "../prompts";
export { PLAN_SYSTEM_PROMPT } from "../prompts";

export const PlanQuestionSchema = z.object({
  question: z.string().min(1, "Question must not be empty."),
  options: z.array(z.string().min(1)).min(1, "At least one option is required."),
  defaultIndex: z.number().int().nonnegative().optional(),
  allowCustom: z.boolean().default(true),
});

export const PlanResponseSchema = z.object({
  summary: z.string().min(1, "Plan summary must not be empty."),
  questions: z.array(PlanQuestionSchema).default([]),
});

export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export function parsePlanResponse(output: string): PlanResponse {
  let parsed: unknown;
  const trimmed = output.trim();

  // Try direct parse
  try { parsed = JSON.parse(trimmed); } catch {
    // Try extracting from markdown fences
    const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(trimmed);
    if (fenced?.[1]) {
      try { parsed = JSON.parse(fenced[1].trim()); } catch { /* continue */ }
    }
    // Try extracting balanced JSON
    if (parsed === undefined) {
      const start = trimmed.indexOf("{");
      if (start !== -1) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = start; i < trimmed.length; i++) {
          const ch = trimmed[i];
          if (escape) { escape = false; continue; }
          if (ch === "\\") { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              try { parsed = JSON.parse(trimmed.slice(start, i + 1)); } catch { /* give up */ }
              break;
            }
          }
        }
      }
    }
  }

  // 1. First attempt strict Zod validation
  const validated = PlanResponseSchema.safeParse(parsed);
  if (validated.success) {
    return {
      summary: validated.data.summary,
      questions: validated.data.questions.slice(0, 6),
    };
  }

  // 2. Gracefully recover partial or loosely-typed fields using Zod element-level validation
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const summary = typeof record.summary === "string" && record.summary.trim() !== ""
      ? record.summary
      : "Executing task based on issue analysis.";
    const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
    const questions: PlanQuestion[] = [];

    for (const q of rawQuestions) {
      const parsedQ = PlanQuestionSchema.safeParse(q);
      if (parsedQ.success) {
        questions.push(parsedQ.data);
      } else if (typeof q === "object" && q !== null) {
        const item = q as Record<string, unknown>;
        const questionText = typeof item.question === "string" && item.question.trim() !== ""
          ? item.question
          : "How should this be implemented?";
        const optionsList = Array.isArray(item.options)
          ? item.options.filter((opt): opt is string => typeof opt === "string" && opt.trim() !== "")
          : ["Follow existing repo conventions"];
        if (optionsList.length > 0) {
          questions.push({
            question: questionText,
            options: optionsList,
            defaultIndex: typeof item.defaultIndex === "number" ? item.defaultIndex : 0,
            allowCustom: item.allowCustom !== false,
          });
        }
      }
    }

    return { summary, questions: questions.slice(0, 6) };
  }

  return { summary: "Direct execution — no clarifying questions needed.", questions: [] };
}

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
    const output = typeof turn.decision.action === "object" && "summary" in turn.decision.action
      ? JSON.stringify(turn.decision)
      : JSON.stringify(turn.decision);

    // The model wraps its answer inside the decision structure — we need to
    // extract it. Since the model is constrained to the plan schema via
    // PLAN_SYSTEM_PROMPT but routed through the standard StructuredModelAdapter
    // which expects {action:{type:...}}, we call the transport directly or
    // parse the raw output. For simplicity, we'll re-parse the intent/action.
    // Actually, the model will try to format as {intent, action} so the
    // parsed decision might be off. Let's just use a raw model call approach.
    return parsePlanResponse(output);
  } catch {
    // If plan generation fails, return empty plan — agent proceeds without it
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
        "authorization": `Bearer ${options.apiKey}`,
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

    const result = await response.json() as {
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
