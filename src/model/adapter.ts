import { parseModelDecision, parseProviderUsage } from "./schema";
import type {
  CompletionBudget,
  ModelAdapter,
  ModelRequest,
  ModelTurn,
  ModelUsage,
  TextTurn,
} from "./types";

export type ModelErrorKind =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "transport"
  | "invalid_response"
  | "budget_exhausted"
  | "cancelled";

export class ModelError extends Error {
  /** How long the provider asked us to wait before retrying (from Retry-After), if it said. */
  readonly retryAfterMs: number | undefined;
  /**
   * Usage of attempts the provider answered but that still failed (an unparseable reply is
   * billed like any other). Filled in by the adapter so failed calls still count toward cost.
   */
  usage: ModelUsage[] = [];

  constructor(
    public readonly kind: ModelErrorKind,
    message: string,
    public readonly retryable: boolean,
    public readonly attempts: number,
    options?: ErrorOptions & { retryAfterMs?: number | undefined; usage?: ModelUsage | undefined },
  ) {
    super(message, options);
    this.name = "ModelError";
    this.retryAfterMs = options?.retryAfterMs;
    if (options?.usage !== undefined) this.usage.push(options.usage);
  }
}

export type ModelTransportErrorKind = "authentication" | "rate_limit" | "transient" | "permanent";

export class ModelTransportError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(
    public readonly kind: ModelTransportErrorKind,
    message: string,
    options?: ErrorOptions & { retryAfterMs?: number | undefined },
  ) {
    super(message, options);
    this.name = "ModelTransportError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** A provider's Retry-After is honoured up to this long; beyond it the run's budget decides. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Reads Retry-After (seconds or an HTTP date) from an SDK error that exposes response headers. */
export function retryAfterMs(error: unknown, now: number = Date.now()): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  const value = headers instanceof Headers
    ? headers.get("retry-after")
    : typeof headers === "object" && headers !== null
      ? (headers as Record<string, unknown>)["retry-after"]
      : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export interface ModelTransport {
  send(request: ModelRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ModelAdapterOptions {
  maxAttempts?: number;
  requestTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /**
   * Waits after a rate limit that gave no Retry-After. Exponential backoff in milliseconds suits a
   * flaky connection, not a shared free pool that refills over seconds, so rate limits get their
   * own, longer schedule, and one more attempt per entry when that exceeds maxAttempts.
   */
  rateLimitBackoffMs?: readonly number[];
}

interface AdapterDependencies {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  requestTimeoutMs: 30_000,
  initialBackoffMs: 250,
  maxBackoffMs: 2_000,
  rateLimitBackoffMs: [5_000, 15_000, 30_000] as readonly number[],
} as const;

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function cancelledError(attempts: number): ModelError {
  return new ModelError("cancelled", "Model request was cancelled.", false, attempts);
}

function errorFromTransport(error: unknown, attempts: number): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof ModelTransportError) {
    if (error.kind === "authentication") {
      return new ModelError("authentication", error.message, false, attempts, { cause: error });
    }
    if (error.kind === "rate_limit") {
      return new ModelError("rate_limit", error.message, true, attempts, {
        cause: error,
        retryAfterMs: error.retryAfterMs,
      });
    }
    return new ModelError("transport", error.message, error.kind === "transient", attempts, {
      cause: error,
    });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new ModelError("transport", detail, true, attempts, { cause: error });
}

function transportOutput(value: unknown, attempts: number): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelError("invalid_response", "Provider response must be an object.", false, attempts);
  }

  const response = value as Record<string, unknown>;
  if (!("output" in response)) {
    throw new ModelError("invalid_response", "Provider response is missing output.", false, attempts);
  }
  return response;
}

/** Bad token accounting must not throw away a valid decision; it is recorded as unavailable. */
function usageOrUnavailable(value: unknown): ModelUsage {
  try {
    return parseProviderUsage(value);
  } catch {
    return { source: "unavailable" };
  }
}

function parseTransportResponse(value: unknown, attempts: number): ModelTurn {
  const response = transportOutput(value, attempts);
  const usage = usageOrUnavailable(response.usage);
  try {
    return { decision: parseModelDecision(response.output), usage };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelError("invalid_response", detail, false, attempts, { cause: error, usage });
  }
}

function parseTextResponse(value: unknown, attempts: number): TextTurn {
  const response = transportOutput(value, attempts);
  const usage = usageOrUnavailable(response.usage);
  try {
    const output = typeof response.output === "string" ? response.output : JSON.stringify(response.output);
    return { output, usage };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelError("invalid_response", detail, false, attempts, { cause: error, usage });
  }
}

export class StructuredModelAdapter implements ModelAdapter {
  private readonly options: Required<ModelAdapterOptions>;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly transport: ModelTransport,
    options: ModelAdapterOptions = {},
    dependencies: AdapterDependencies = {},
  ) {
    this.options = {
      maxAttempts: positiveInteger(options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts, "maxAttempts"),
      requestTimeoutMs: positiveInteger(
        options.requestTimeoutMs ?? DEFAULT_OPTIONS.requestTimeoutMs,
        "requestTimeoutMs",
      ),
      initialBackoffMs: nonNegativeInteger(
        options.initialBackoffMs ?? DEFAULT_OPTIONS.initialBackoffMs,
        "initialBackoffMs",
      ),
      maxBackoffMs: nonNegativeInteger(
        options.maxBackoffMs ?? DEFAULT_OPTIONS.maxBackoffMs,
        "maxBackoffMs",
      ),
      rateLimitBackoffMs: (options.rateLimitBackoffMs ?? DEFAULT_OPTIONS.rateLimitBackoffMs)
        .map((delay) => nonNegativeInteger(delay, "rateLimitBackoffMs")),
    };
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  }

  async complete(request: ModelRequest, budget: CompletionBudget = {}): Promise<ModelTurn> {
    return await this.withRetries(request, budget, parseTransportResponse);
  }

  async completeText(request: ModelRequest, budget: CompletionBudget = {}): Promise<TextTurn> {
    return await this.withRetries(request, budget, parseTextResponse);
  }

  private async withRetries<T>(
    request: ModelRequest,
    budget: CompletionBudget,
    parse: (response: unknown, attempts: number) => T,
  ): Promise<T> {
    const startedAt = this.now();
    let lastError: ModelError | undefined;
    // Answered-but-failed attempts are still billed, so their usage travels with the result or error.
    let wasted: ModelUsage[] = [];
    const withWasted = (error: ModelError): ModelError => {
      error.usage = [...wasted, ...error.usage];
      return error;
    };

    const rateLimitAttempts = Math.max(this.options.maxAttempts, this.options.rateLimitBackoffMs.length + 1);
    let rateLimits = 0;
    for (let attempt = 1; attempt <= rateLimitAttempts; attempt += 1) {
      if (budget.signal?.aborted === true) throw withWasted(cancelledError(attempt - 1));
      const remainingMs = this.remainingBudget(startedAt, budget.remainingTimeMs);
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw withWasted(new ModelError(
          "budget_exhausted",
          "Model-call time budget was exhausted before another attempt.",
          false,
          attempt - 1,
        ));
      }

      const timeoutMs = Math.max(
        1,
        Math.min(this.options.requestTimeoutMs, remainingMs ?? this.options.requestTimeoutMs),
      );

      try {
        const response = await this.sendWithTimeout(request, timeoutMs, attempt, budget.signal);
        const parsed = parse(response, attempt);
        return wasted.length === 0 ? parsed : { ...parsed, wastedUsage: [...wasted] };
      } catch (error) {
        const modelError = withWasted(errorFromTransport(error, attempt));
        lastError = modelError;
        const rateLimited = modelError.kind === "rate_limit";
        const limit = rateLimited ? rateLimitAttempts : this.options.maxAttempts;
        if (!modelError.retryable || attempt >= limit) throw modelError;
        wasted = modelError.usage;

        const schedule = this.options.rateLimitBackoffMs;
        const delay = modelError.retryAfterMs !== undefined
          ? Math.min(modelError.retryAfterMs, MAX_RETRY_AFTER_MS)
          : rateLimited && schedule.length > 0
            ? schedule[Math.min(rateLimits, schedule.length - 1)]!
            : Math.min(this.options.initialBackoffMs * 2 ** (attempt - 1), this.options.maxBackoffMs);
        if (rateLimited) rateLimits += 1;
        const remainingAfterAttempt = this.remainingBudget(startedAt, budget.remainingTimeMs);
        if (remainingAfterAttempt !== undefined && remainingAfterAttempt <= delay) {
          throw withWasted(new ModelError(
            "budget_exhausted",
            "Model-call time budget cannot accommodate the next retry.",
            false,
            attempt,
            { cause: modelError },
          ));
        }
        await this.sleep(delay);
      }
    }

    throw lastError ?? withWasted(new ModelError("transport", "Model call failed.", false, 0));
  }

  private remainingBudget(startedAt: number, availableMs: number | undefined): number | undefined {
    if (availableMs === undefined) return undefined;
    return availableMs - (this.now() - startedAt);
  }

  private async sendWithTimeout(
    request: ModelRequest,
    timeoutMs: number,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      if (signal === undefined) return;
      onAbort = () => {
        controller.abort();
        reject(cancelledError(attempt));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new ModelError(
            "timeout",
            `Model request timed out after ${timeoutMs}ms.`,
            true,
            attempt,
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([this.transport.send(request, controller.signal), timeoutPromise, cancelled]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    }
  }
}
