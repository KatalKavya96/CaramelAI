import { parseModelDecision, parseProviderUsage } from "./schema";
import type {
  CompletionBudget,
  ModelAdapter,
  ModelRequest,
  ModelTurn,
  TextTurn,
} from "./types";

export type ModelErrorKind =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "transport"
  | "invalid_response"
  | "budget_exhausted";

export class ModelError extends Error {
  constructor(
    public readonly kind: ModelErrorKind,
    message: string,
    public readonly retryable: boolean,
    public readonly attempts: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelError";
  }
}

export type ModelTransportErrorKind = "authentication" | "rate_limit" | "transient" | "permanent";

export class ModelTransportError extends Error {
  constructor(
    public readonly kind: ModelTransportErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelTransportError";
  }
}

export interface ModelTransport {
  send(request: ModelRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ModelAdapterOptions {
  maxAttempts?: number;
  requestTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
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

function errorFromTransport(error: unknown, attempts: number): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof ModelTransportError) {
    if (error.kind === "authentication") {
      return new ModelError("authentication", error.message, false, attempts, { cause: error });
    }
    if (error.kind === "rate_limit") {
      return new ModelError("rate_limit", error.message, true, attempts, { cause: error });
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

function parseTransportResponse(value: unknown, attempts: number): ModelTurn {
  const response = transportOutput(value, attempts);
  try {
    return {
      decision: parseModelDecision(response.output),
      usage: parseProviderUsage(response.usage),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelError("invalid_response", detail, false, attempts, { cause: error });
  }
}

function parseTextResponse(value: unknown, attempts: number): TextTurn {
  const response = transportOutput(value, attempts);
  try {
    const output = typeof response.output === "string" ? response.output : JSON.stringify(response.output);
    return { output, usage: parseProviderUsage(response.usage) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelError("invalid_response", detail, false, attempts, { cause: error });
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

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      const remainingMs = this.remainingBudget(startedAt, budget.remainingTimeMs);
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new ModelError(
          "budget_exhausted",
          "Model-call time budget was exhausted before another attempt.",
          false,
          attempt - 1,
        );
      }

      const timeoutMs = Math.max(
        1,
        Math.min(this.options.requestTimeoutMs, remainingMs ?? this.options.requestTimeoutMs),
      );

      try {
        const response = await this.sendWithTimeout(request, timeoutMs, attempt);
        return parse(response, attempt);
      } catch (error) {
        const modelError = errorFromTransport(error, attempt);
        lastError = modelError;
        if (!modelError.retryable || attempt === this.options.maxAttempts) throw modelError;

        const delay = Math.min(
          this.options.initialBackoffMs * 2 ** (attempt - 1),
          this.options.maxBackoffMs,
        );
        const remainingAfterAttempt = this.remainingBudget(startedAt, budget.remainingTimeMs);
        if (remainingAfterAttempt !== undefined && remainingAfterAttempt <= delay) {
          throw new ModelError(
            "budget_exhausted",
            "Model-call time budget cannot accommodate the next retry.",
            false,
            attempt,
            { cause: modelError },
          );
        }
        await this.sleep(delay);
      }
    }

    throw lastError ?? new ModelError("transport", "Model call failed.", false, 0);
  }

  private remainingBudget(startedAt: number, availableMs: number | undefined): number | undefined {
    if (availableMs === undefined) return undefined;
    return availableMs - (this.now() - startedAt);
  }

  private async sendWithTimeout(
    request: ModelRequest,
    timeoutMs: number,
    attempt: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
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
      return await Promise.race([this.transport.send(request, controller.signal), timeoutPromise]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
