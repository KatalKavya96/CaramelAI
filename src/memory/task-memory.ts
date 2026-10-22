import type { ModelAction, ModelDecision, ModelMessage } from "../model";
import type { FailureRecord } from "../recovery";
import type { VerificationEvidence } from "../verification";
import type { TaskMemoryLimits, TaskMemorySnapshot } from "./types";

interface TurnPair { assistant: ModelMessage; user: ModelMessage }

const DEFAULT_LIMITS: TaskMemoryLimits = {
  maxContextChars: 32_000,
  reserveResponseChars: 6_000,
  maxRecentPairs: 5,
  maxEntryChars: 1_200,
};

const EXACT_READ_CONTEXT_CHARS = 3_600;
const LARGE_READ_EXCERPT_CHARS = 900;
// The summary may use at most this share of the space left after the system prompt;
// the rest is reserved for recent action/observation pairs.
const SUMMARY_SHARE = 0.5;
// Each remembered list keeps only its newest entries.
const MAX_LIST_ENTRIES = 12;
const ELIDED = "…[elided]…";

function clipped(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…[truncated]`;
}

/** Keeps the start and the end of an over-long text, which usually carry the most meaning. */
function headAndTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= ELIDED.length) return text.slice(0, Math.max(0, maxChars));
  const kept = maxChars - ELIDED.length;
  const head = Math.ceil(kept * 0.7);
  return `${text.slice(0, head)}${ELIDED}${text.slice(text.length - (kept - head))}`;
}

function pushBounded(target: string[], value: string): void {
  target.push(value);
  while (target.length > MAX_LIST_ENTRIES) target.shift();
}

/** Large edits are remembered by shape, not content, so one edit cannot crowd out the context. */
function assistantContent(decision: ModelDecision, maxChars: number): string {
  const full = JSON.stringify(decision);
  if (full.length <= maxChars) return full;
  const { action } = decision;
  const compactAction =
    action.type === "replace_file"
      ? { type: action.type, path: action.path, contentChars: action.content.length }
      : action.type === "replace_text"
        ? { type: action.type, path: action.path, searchChars: action.search.length, replacementChars: action.replacement.length }
        : action.type === "apply_patch"
          ? { type: action.type, patchExcerpt: headAndTail(action.patch, maxChars / 2) }
          : { type: action.type };
  return JSON.stringify({
    ...(decision.intent === undefined ? {} : { intent: clipped(decision.intent, 300) }),
    action: compactAction,
    harnessNote: "Large action arguments were summarized in memory; always send complete arguments.",
  });
}

function messageChars(messages: readonly ModelMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function compactObservation(action: ModelAction, observation: unknown): unknown {
  if (
    action.type === "read_file" &&
    typeof observation === "object" &&
    observation !== null &&
    "ok" in observation &&
    (observation as { ok?: unknown }).ok === true
  ) {
    const value = (observation as { value?: unknown }).value;
    if (typeof value === "object" && value !== null && "content" in value) {
      const read = value as {
        path?: unknown;
        content?: unknown;
        startLine?: unknown;
        endLine?: unknown;
        totalLines?: unknown;
        truncated?: unknown;
      };
      const content = typeof read.content === "string" ? read.content : "";
      const exact = content.length <= EXACT_READ_CONTEXT_CHARS;
      return {
        ok: true,
        value: {
          path: read.path,
          startLine: read.startLine,
          endLine: read.endLine,
          totalLines: read.totalLines,
          truncated: read.truncated,
          contentChars: content.length,
          exact,
          excerpt: exact ? content : clipped(content, LARGE_READ_EXCERPT_CHARS),
        },
      };
    }
  }
  return observation;
}

export class TaskMemory {
  private readonly limits: TaskMemoryLimits;
  private readonly pairs: TurnPair[] = [];
  private readonly findings: string[] = [];
  private readonly hypotheses: string[] = [];
  private readonly failures: string[] = [];
  private readonly edits: string[] = [];
  private readonly checks: string[] = [];
  private pendingAssistant: ModelMessage | null = null;
  private compactions = 0;
  private largestRequestChars = 0;
  private readCacheHits = 0;
  private readCacheMisses = 0;

  constructor(
    private readonly systemPrompt: string,
    private readonly task: string,
    private readonly repositoryContext: unknown,
    limits: Partial<TaskMemoryLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    if (!Number.isInteger(this.limits.maxContextChars) || this.limits.maxContextChars <= 0) {
      throw new Error("Memory context limit must be a positive integer.");
    }
    if (this.limits.reserveResponseChars >= this.limits.maxContextChars) {
      throw new Error("Memory response reserve must be smaller than the context limit.");
    }
  }

  recordDecision(decision: ModelDecision): void {
    this.pendingAssistant = { role: "assistant", content: assistantContent(decision, this.limits.maxEntryChars * 2) };
    if (decision.intent !== undefined) this.pushUnique(this.hypotheses, decision.intent);
    if (
      decision.action.type === "apply_patch" ||
      decision.action.type === "replace_text" ||
      decision.action.type === "replace_file"
    ) {
      pushBounded(this.edits, clipped(decision.intent ?? "Edited code", 300));
    }
  }

  recordObservation(action: ModelAction, observation: unknown): void {
    const assistant = this.pendingAssistant ?? { role: "assistant", content: JSON.stringify({ action: action.type }) };
    const user = { role: "user" as const, content: `Observed result for ${action.type}:\n${clipped(compactObservation(action, observation), this.limits.maxEntryChars)}` };
    this.pairs.push({ assistant, user });
    this.pendingAssistant = null;
    if (action.type === "read_file") this.pushUnique(this.findings, `${action.path}:${action.startLine ?? 1}-${action.endLine ?? "end"}: ${clipped(compactObservation(action, observation), 500)}`);
    this.compactPairs();
  }

  recordInvalidResponse(detail: string): void {
    this.pairs.push({
      assistant: { role: "assistant", content: JSON.stringify({ invalidResponse: true }) },
      user: { role: "user", content: `Your prior response was invalid: ${clipped(detail, 500)} Return one valid structured action.` },
    });
    this.compactPairs();
  }

  recordGuidance(detail: string): void {
    this.pairs.push({
      assistant: { role: "assistant", content: JSON.stringify({ controllerIntervention: true }) },
      user: { role: "user", content: clipped(detail, this.limits.maxEntryChars) },
    });
    this.compactPairs();
  }

  recordFailure(failure: FailureRecord): void {
    pushBounded(this.failures, clipped(failure, 800));
  }

  recordCheck(evidence: VerificationEvidence): void {
    pushBounded(this.checks, clipped({ command: evidence.command, status: evidence.status, fingerprint: evidence.codeFingerprint, testCounts: evidence.testCounts }, 800));
  }

  recordReadCache(hit: boolean): void {
    if (hit) this.readCacheHits += 1;
    else this.readCacheMisses += 1;
  }

  /**
   * Budget split: system prompt, then a summary capped at SUMMARY_SHARE of what remains, then
   * recent pairs newest-first. The newest pair is always included (clipped if necessary), so
   * the model always sees the result of its latest action.
   */
  request(): { messages: ModelMessage[] } {
    const budget = this.limits.maxContextChars - this.limits.reserveResponseChars;
    const afterSystem = Math.max(0, budget - this.systemPrompt.length);
    const permanent: ModelMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: this.summary(Math.floor(afterSystem * SUMMARY_SHARE)) },
    ];
    const selected: TurnPair[] = [];
    let used = messageChars(permanent);
    const newestFirst = [...this.pairs].reverse();
    for (const [index, pair] of newestFirst.entries()) {
      const pairChars = pair.assistant.content.length + pair.user.content.length;
      if (used + pairChars <= budget) {
        selected.unshift(pair);
        used += pairChars;
        continue;
      }
      if (index === 0) {
        const room = Math.max(0, budget - used);
        const assistant = { ...pair.assistant, content: headAndTail(pair.assistant.content, Math.floor(room / 3)) };
        const user = { ...pair.user, content: headAndTail(pair.user.content, room - assistant.content.length) };
        selected.unshift({ assistant, user });
        used += assistant.content.length + user.content.length;
      }
      this.compactions += 1;
      break;
    }
    const messages = [...permanent, ...selected.flatMap((pair) => [pair.assistant, pair.user])];
    this.largestRequestChars = Math.max(this.largestRequestChars, messageChars(messages));
    return { messages };
  }

  snapshot(): TaskMemorySnapshot {
    return {
      maxContextChars: this.limits.maxContextChars,
      reserveResponseChars: this.limits.reserveResponseChars,
      largestRequestChars: this.largestRequestChars,
      compactions: this.compactions,
      recentPairs: this.pairs.length,
      findings: this.findings.length,
      hypotheses: this.hypotheses.length,
      failures: this.failures.length,
      edits: this.edits.length,
      checks: this.checks.length,
      readCacheHits: this.readCacheHits,
      readCacheMisses: this.readCacheMisses,
    };
  }

  /**
   * Builds the summary as valid JSON within `maxChars`. When it is too long, the oldest entries
   * of the least valuable list go first; only then are the repository context and the task shortened.
   */
  private summary(maxChars: number): string {
    const lists = {
      failureHistory: [...this.failures],
      checks: [...this.checks],
      hypotheses: [...this.hypotheses],
      edits: [...this.edits],
      findings: [...this.findings],
    };
    let task = this.task;
    let repository: unknown = this.repositoryContext;
    const render = () => JSON.stringify({
      originalTask: task,
      taskPriority: "Binding contract: implement every requested behavior and constraint; compare the final diff and checks against this task before finishing.",
      repository,
      ...lists,
    });

    // Eviction order: cheapest to lose first. Failures and checks are what stop the model
    // repeating a mistake, so they go last.
    const evictionOrder = [lists.findings, lists.hypotheses, lists.edits, lists.checks, lists.failureHistory];
    let text = render();
    while (text.length > maxChars) {
      const victim = evictionOrder.find((entries) => entries.length > 0);
      if (victim === undefined) break;
      victim.shift();
      this.compactions += 1;
      text = render();
    }
    if (text.length > maxChars) {
      repository = clipped(repository, Math.max(200, Math.floor(maxChars / 4)));
      text = render();
    }
    if (text.length > maxChars) {
      const overflow = text.length - maxChars;
      task = headAndTail(task, Math.max(0, task.length - overflow - ELIDED.length));
      text = render();
    }
    return text.length <= maxChars ? text : clipped(text, maxChars);
  }

  private compactPairs(): void {
    while (this.pairs.length > this.limits.maxRecentPairs) {
      this.pairs.shift();
      this.compactions += 1;
    }
  }

  private pushUnique(target: string[], value: string): void {
    if (!target.includes(value)) pushBounded(target, value);
  }
}
