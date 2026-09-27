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

function clipped(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…[truncated]`;
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
    this.pendingAssistant = { role: "assistant", content: JSON.stringify(decision) };
    if (decision.intent !== undefined) this.pushUnique(this.hypotheses, decision.intent);
    if (
      decision.action.type === "apply_patch" ||
      decision.action.type === "replace_text" ||
      decision.action.type === "replace_file"
    ) {
      this.edits.push(clipped(decision.intent ?? "Edited code", 300));
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
    this.failures.push(clipped(failure, 800));
  }

  recordCheck(evidence: VerificationEvidence): void {
    this.checks.push(clipped({ command: evidence.command, status: evidence.status, fingerprint: evidence.codeFingerprint, testCounts: evidence.testCounts }, 800));
  }

  recordReadCache(hit: boolean): void {
    if (hit) this.readCacheHits += 1;
    else this.readCacheMisses += 1;
  }

  request(): { messages: ModelMessage[] } {
    const budget = this.limits.maxContextChars - this.limits.reserveResponseChars;
    const permanent: ModelMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: this.summary() },
    ];
    const selected: TurnPair[] = [];
    let used = messageChars(permanent);
    for (const pair of [...this.pairs].reverse()) {
      const pairChars = pair.assistant.content.length + pair.user.content.length;
      if (used + pairChars > budget) { this.compactions += 1; break; }
      selected.unshift(pair);
      used += pairChars;
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

  private summary(): string {
    return clipped({
      originalTask: this.task,
      taskPriority: "Binding contract: implement every requested behavior and constraint; compare the final diff and checks against this task before finishing.",
      repository: this.repositoryContext,
      failureHistory: this.failures,
      checks: this.checks,
      hypotheses: this.hypotheses,
      edits: this.edits,
      findings: this.findings,
    }, this.limits.maxContextChars - this.limits.reserveResponseChars - this.systemPrompt.length);
  }

  private compactPairs(): void {
    while (this.pairs.length > this.limits.maxRecentPairs) {
      this.pairs.shift();
      this.compactions += 1;
    }
  }

  private pushUnique(target: string[], value: string): void {
    if (!target.includes(value)) target.push(value);
  }
}
