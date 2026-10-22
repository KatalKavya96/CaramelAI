import { act, renderHook } from "@testing-library/react";
import { useRunEvents, type EventSourceLike } from "../src/data/useRunEvents";
import { VERIFIED_RUN } from "./fixtures/events";

class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

function setup(url: string | null = "/api/runs/run_a/events") {
  const sources: FakeSource[] = [];
  const onFinished = vi.fn();
  const factory = (target: string) => {
    const source = new FakeSource(target);
    sources.push(source);
    return source;
  };
  const hook = renderHook(() => useRunEvents(url, { onFinished, factory }));
  return { hook, sources, onFinished };
}

describe("useRunEvents", () => {
  it("streams events into state and closes after run_finished", () => {
    const { hook, sources, onFinished } = setup();
    const source = sources[0] as FakeSource;
    act(() => source.onopen?.(new Event("open")));
    expect(hook.result.current.stream).toBe("open");
    act(() => {
      for (const event of VERIFIED_RUN) source.emit(event.type, event);
    });
    expect(hook.result.current.state.run.status).toBe("verified");
    expect(hook.result.current.stream).toBe("closed");
    expect(source.closed).toBe(true);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("reports reconnecting while the browser retries, and ignores replayed events", () => {
    const { hook, sources } = setup();
    const source = sources[0] as FakeSource;
    act(() => {
      for (const event of VERIFIED_RUN.slice(0, 6)) source.emit(event.type, event);
      source.onerror?.(new Event("error"));
    });
    expect(hook.result.current.stream).toBe("reconnecting");
    act(() => {
      // The server resumes after Last-Event-ID, but an overlap must not duplicate steps.
      for (const event of VERIFIED_RUN.slice(4, 10)) source.emit(event.type, event);
    });
    expect(hook.result.current.state.run.steps.map((step) => step.step)).toEqual([1, 2, 3]);
  });

  it("handles run_closed for runs that ended without an agent log", () => {
    const { hook, sources, onFinished } = setup();
    act(() => (sources[0] as FakeSource).emit("run_closed", { status: "failed" }));
    expect(hook.result.current.state.closedStatus).toBe("failed");
    expect(hook.result.current.stream).toBe("closed");
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("does not connect without a url", () => {
    const { hook, sources } = setup(null);
    expect(sources).toHaveLength(0);
    expect(hook.result.current.stream).toBe("idle");
  });
});
