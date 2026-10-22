import { useEffect, useReducer, useState } from "react";
import type { AgentEvent, AgentEventType, AgentStatus } from "../lib/contract";
import { INITIAL_LIVE_RUN, reduceLiveRun, type LiveRunState } from "./live-run";

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** The parts of EventSource this hook uses, so tests can pass a fake. */
export interface EventSourceLike {
  readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const EVENT_TYPES: AgentEventType[] = ["run_started", "model_decision", "model_error", "step_started", "tool_result", "run_finished"];
const CLOSED = 2;

type Action = { kind: "event"; event: AgentEvent } | { kind: "closed"; status: AgentStatus } | { kind: "reset" };

function reducer(state: LiveRunState, action: Action): LiveRunState {
  switch (action.kind) {
    case "event":
      return reduceLiveRun(state, action.event);
    case "closed":
      return { ...state, closedStatus: action.status };
    case "reset":
      return INITIAL_LIVE_RUN;
  }
}

const defaultFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true }) as unknown as EventSourceLike;

/**
 * Streams a run's events over SSE and folds them with the core reducer. The browser's EventSource
 * reconnects by itself and sends Last-Event-ID, and the server replays only what was missed, so a
 * dropped connection or a page reload lands on the same state a live viewer had.
 */
export function useRunEvents(
  url: string | null,
  { onFinished, factory = defaultFactory }: { onFinished?: () => void; factory?: EventSourceFactory } = {},
): { state: LiveRunState; stream: StreamStatus } {
  const [state, dispatch] = useReducer(reducer, INITIAL_LIVE_RUN);
  const [stream, setStream] = useState<StreamStatus>("idle");

  useEffect(() => {
    dispatch({ kind: "reset" });
    if (url === null) {
      setStream("idle");
      return;
    }
    setStream("connecting");
    const source = factory(url);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      source.close();
      setStream("closed");
      onFinished?.();
    };
    source.onopen = () => {
      if (!done) setStream("open");
    };
    source.onerror = () => {
      if (done) return;
      setStream(source.readyState === CLOSED ? "closed" : "reconnecting");
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        const event = JSON.parse(message.data) as AgentEvent;
        dispatch({ kind: "event", event });
        if (event.type === "run_finished") finish();
      });
    }
    source.addEventListener("run_closed", (message) => {
      const { status } = JSON.parse(message.data) as { status: AgentStatus };
      dispatch({ kind: "closed", status });
      finish();
    });
    return () => {
      done = true;
      source.close();
    };
    // onFinished is a callback for side effects only; reconnecting when it changes would replay the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, factory]);

  return { state, stream };
}
