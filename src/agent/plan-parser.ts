import { z } from "zod";
import type { PlanQuestion } from "./types";

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

function extractJsonText(trimmed: string): string | undefined {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

function parseJsonLenient(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const extracted = extractJsonText(trimmed);
    if (extracted !== undefined) {
      try {
        return JSON.parse(extracted);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function recoverQuestions(rawQuestions: unknown[]): PlanQuestion[] {
  const questions: PlanQuestion[] = [];
  for (const q of rawQuestions) {
    const parsedQ = PlanQuestionSchema.safeParse(q);
    if (parsedQ.success) {
      questions.push(parsedQ.data);
    } else if (typeof q === "object" && q !== null) {
      const item = q as Record<string, unknown>;
      const questionText =
        typeof item.question === "string" && item.question.trim() !== ""
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
  return questions;
}

export function parsePlanResponse(output: string): PlanResponse {
  const parsed = parseJsonLenient(output);

  // 1. Strict Zod validation
  const validated = PlanResponseSchema.safeParse(parsed);
  if (validated.success) {
    return {
      summary: validated.data.summary,
      questions: validated.data.questions.slice(0, 6),
    };
  }

  // 2. Gracefully recover partial or loosely-typed fields
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const summary =
      typeof record.summary === "string" && record.summary.trim() !== ""
        ? record.summary
        : "Executing task based on issue analysis.";
    const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
    return { summary, questions: recoverQuestions(rawQuestions).slice(0, 6) };
  }

  return { summary: "Direct execution — no clarifying questions needed.", questions: [] };
}
