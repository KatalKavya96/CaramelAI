import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@web/lib/contract";
import { INITIAL_LIVE_RUN, reduceLiveRun, type LiveRunState } from "@web/data/live-run";
import { buildSchedule, visibleCount } from "./schedule";

export interface Replay {
  state: LiveRunState;
  playing: boolean;
  done: boolean;
  /** 0 to 1, for the progress bar. */
  progress: number;
  play: () => void;
  pause: () => void;
  restart: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Plays a recorded run through the app's own live-run reducer, so the replay shows exactly what a
 * viewer of the real run saw. With reduced motion it starts on the finished run instead of animating.
 */
export function useReplay(events: readonly AgentEvent[], { autoplay = true }: { autoplay?: boolean } = {}): Replay {
  const schedule = useMemo(() => buildSchedule(events), [events]);
  const total = schedule.at(-1) ?? 0;
  const reduced = useMemo(prefersReducedMotion, []);
  const [elapsed, setElapsed] = useState(() => (reduced ? total : 0));
  const [playing, setPlaying] = useState(autoplay && !reduced);
  // Bumped by restart, so the animation loop starts over even when it was already playing.
  const [session, setSession] = useState(0);
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;

  // A new run (tab switch) starts from the top, or from the end with reduced motion.
  useEffect(() => {
    setElapsed(reduced ? total : 0);
    setPlaying(autoplay && !reduced);
    setSession((value) => value + 1);
  }, [events, total, reduced, autoplay]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const origin = performance.now() - elapsedRef.current;
    const tick = (now: number) => {
      const next = now - origin;
      if (next >= total) {
        setElapsed(total);
        setPlaying(false);
        return;
      }
      setElapsed(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, total, session]);

  const count = visibleCount(schedule, elapsed);
  const state = useMemo(() => events.slice(0, count).reduce(reduceLiveRun, INITIAL_LIVE_RUN), [events, count]);

  return {
    state,
    playing,
    done: count >= events.length,
    progress: total === 0 ? 1 : Math.min(1, elapsed / total),
    play: () => {
      if (elapsed >= total) {
        elapsedRef.current = 0;
        setElapsed(0);
      }
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    restart: () => {
      elapsedRef.current = 0;
      setElapsed(0);
      setSession((value) => value + 1);
      setPlaying(true);
    },
  };
}
