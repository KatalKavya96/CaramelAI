import { describe, expect, test } from "bun:test";
import {
  FakeModelAdapter,
  MAX_RETRY_AFTER_MS,
  retryAfterMs,
  ModelError,
  ModelTransportError,
  StructuredModelAdapter,
  type ModelRequest,
  type ModelTransport,
} from "../src/model";

const REQUEST: ModelRequest = {
  messages: [{ role: "user", content: "Inspect the repository" }],
};

class ScriptedTransport implements ModelTransport {
  calls = 0;

  constructor(private readonly script: readonly (unknown | Error)[]) {}

  async send(_request: ModelRequest, _signal: AbortSignal): Promise<unknown> {
    const step = this.script[this.calls];
    this.calls += 1;
    if (step instanceof Error) throw step;
    return step;
  }
}

const SUCCESS = {
  output: { intent: "inspect", action: { type: "list_files", path: "." } },
  usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
};

describe("StructuredModelAdapter", () => {
  test("returns a validated decision and reported usage", async () => {
    const adapter = new StructuredModelAdapter(new ScriptedTransport([SUCCESS]));

    expect(await adapter.complete(REQUEST)).toEqual({
      decision: { intent: "inspect", action: { type: "list_files", path: "." } },
      usage: { source: "provider", inputTokens: 8, outputTokens: 3, totalTokens: 11 },
    });
  });

  test("retries transient failures with bounded backoff", async () => {
    const transport = new ScriptedTransport([
      new ModelTransportError("rate_limit", "slow down"),
      new ModelTransportError("transient", "gateway unavailable"),
      SUCCESS,
    ]);
    const delays: number[] = [];
    const adapter = new StructuredModelAdapter(
      transport,
      { maxAttempts: 3, initialBackoffMs: 10, maxBackoffMs: 20 },
      {
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );

    const result = await adapter.complete(REQUEST);
    expect(result.decision.action.type).toBe("list_files");
    expect(transport.calls).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  test("does not retry authentication errors", async () => {
    const transport = new ScriptedTransport([
      new ModelTransportError("authentication", "bad credential"),
      SUCCESS,
    ]);
    const adapter = new StructuredModelAdapter(transport, { initialBackoffMs: 0 });

    await expect(adapter.complete(REQUEST)).rejects.toMatchObject({
      kind: "authentication",
      retryable: false,
      attempts: 1,
    });
    expect(transport.calls).toBe(1);
  });

  test("stops after the configured retry limit", async () => {
    const transport = new ScriptedTransport([
      new ModelTransportError("transient", "one"),
      new ModelTransportError("transient", "two"),
    ]);
    const adapter = new StructuredModelAdapter(
      transport,
      { maxAttempts: 2, initialBackoffMs: 0 },
      { sleep: async () => {} },
    );

    await expect(adapter.complete(REQUEST)).rejects.toMatchObject({
      kind: "transport",
      retryable: true,
      attempts: 2,
    });
    expect(transport.calls).toBe(2);
  });

  test("times out a transport that never settles", async () => {
    const transport: ModelTransport = {
      send: async () => await new Promise(() => {}),
    };
    const adapter = new StructuredModelAdapter(transport, {
      maxAttempts: 1,
      requestTimeoutMs: 10,
    });

    await expect(adapter.complete(REQUEST)).rejects.toMatchObject({ kind: "timeout", attempts: 1 });
  });

  test("does not start a retry that exceeds the remaining time budget", async () => {
    const transport = new ScriptedTransport([new ModelTransportError("rate_limit", "wait")]);
    const adapter = new StructuredModelAdapter(
      transport,
      { maxAttempts: 3, initialBackoffMs: 50 },
      { sleep: async () => {} },
    );

    await expect(adapter.complete(REQUEST, { remainingTimeMs: 20 })).rejects.toMatchObject({
      kind: "budget_exhausted",
      attempts: 1,
    });
    expect(transport.calls).toBe(1);
  });

  test("rejects malformed output without an unbounded retry", async () => {
    const transport = new ScriptedTransport([{ output: "not-json" }, SUCCESS]);
    const adapter = new StructuredModelAdapter(transport);

    await expect(adapter.complete(REQUEST)).rejects.toMatchObject({
      kind: "invalid_response",
      retryable: false,
      attempts: 1,
    });
    expect(transport.calls).toBe(1);
  });
});

describe("FakeModelAdapter", () => {
  test("returns scripted turns and records cloned requests", async () => {
    const fake = new FakeModelAdapter([
      {
        decision: { action: { type: "finish", summary: "done" } },
        usage: { source: "unavailable" },
      },
    ]);

    expect((await fake.complete(REQUEST)).decision.action.type).toBe("finish");
    expect(fake.requests).toEqual([REQUEST]);
    await expect(fake.complete(REQUEST)).rejects.toBeInstanceOf(ModelError);
  });
});

describe("StructuredModelAdapter cancellation", () => {
  test("aborts the in-flight request and does not retry", async () => {
    let calls = 0;
    let transportSignal: AbortSignal | undefined;
    const hanging: ModelTransport = {
      send: (_request, signal) => {
        calls += 1;
        transportSignal = signal;
        return new Promise(() => {});
      },
    };
    const adapter = new StructuredModelAdapter(hanging, { requestTimeoutMs: 60_000, maxAttempts: 3 });
    const cancellation = new AbortController();
    setTimeout(() => cancellation.abort(), 5);

    const error = await adapter.complete(REQUEST, { signal: cancellation.signal }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.kind).toBe("cancelled");
    expect(error.retryable).toBeFalse();
    expect(calls).toBe(1);
    expect(transportSignal?.aborted).toBeTrue();
  });
});

describe("StructuredModelAdapter provider signals", () => {
  test("waits as long as Retry-After asks on a rate limit, capped", async () => {
    const transport = new ScriptedTransport([
      new ModelTransportError("rate_limit", "slow down", { retryAfterMs: 7_000 }),
      new ModelTransportError("rate_limit", "slow down", { retryAfterMs: 600_000 }),
      SUCCESS,
    ]);
    const delays: number[] = [];
    const adapter = new StructuredModelAdapter(transport, { maxAttempts: 3, initialBackoffMs: 10 }, {
      sleep: async (delay) => { delays.push(delay); },
    });
    await adapter.complete(REQUEST);
    expect(delays).toEqual([7_000, MAX_RETRY_AFTER_MS]);
  });

  test("gives up early when Retry-After does not fit the remaining budget", async () => {
    const transport = new ScriptedTransport([
      new ModelTransportError("rate_limit", "slow down", { retryAfterMs: 30_000 }),
      SUCCESS,
    ]);
    const adapter = new StructuredModelAdapter(transport, {}, { sleep: async () => {} });
    await expect(adapter.complete(REQUEST, { remainingTimeMs: 5_000 })).rejects.toMatchObject({ kind: "budget_exhausted" });
    expect(transport.calls).toBe(1);
  });

  test("parses Retry-After from SDK error headers as seconds or an HTTP date", () => {
    expect(retryAfterMs({ headers: new Headers({ "retry-after": "3" }) })).toBe(3_000);
    expect(retryAfterMs({ headers: { "retry-after": "Wed, 21 Oct 2026 07:28:10 GMT" } }, Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(10_000);
    expect(retryAfterMs({ headers: new Headers() })).toBeUndefined();
    expect(retryAfterMs(new Error("no headers"))).toBeUndefined();
  });

  test("keeps a valid decision when the provider's usage numbers are malformed", async () => {
    const adapter = new StructuredModelAdapter(new ScriptedTransport([
      { output: SUCCESS.output, usage: { inputTokens: -1, outputTokens: "x", totalTokens: 0 } },
    ]));
    const turn = await adapter.complete(REQUEST);
    expect(turn.decision.action.type).toBe("list_files");
    expect(turn.usage).toEqual({ source: "unavailable" });
  });
});
