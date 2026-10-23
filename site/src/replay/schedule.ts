import type { AgentEvent } from "@web/lib/contract";

export interface Pacing {
  /** Shortest pause before an event, so fast bursts stay readable. */
  minGapMs: number;
  /** Longest pause, so a 40-second test run does not stall the page. */
  maxGapMs: number;
}

export const DEFAULT_PACING: Pacing = { minGapMs: 250, maxGapMs: 1100 };

/**
 * When each event appears in the replay, in ms from the start. Real gaps between events are kept
 * but clamped, so the replay keeps the run's rhythm (a slow test step still feels slower than a
 * file read) without taking as long as the run did.
 */
export function buildSchedule(events: readonly AgentEvent[], pacing: Pacing = DEFAULT_PACING): number[] {
  const offsets: number[] = [];
  let previous: number | null = null;
  let offset = 0;
  for (const event of events) {
    const at = Date.parse(event.timestamp);
    if (previous !== null) {
      const gap = Number.isNaN(at) ? pacing.minGapMs : at - previous;
      offset += Math.min(pacing.maxGapMs, Math.max(pacing.minGapMs, gap));
    }
    offsets.push(offset);
    if (!Number.isNaN(at)) previous = at;
  }
  return offsets;
}

/** How many events are visible `elapsedMs` into the replay. */
export function visibleCount(schedule: readonly number[], elapsedMs: number): number {
  let low = 0;
  let high = schedule.length;
  // First index whose offset is after elapsedMs; everything before it is visible.
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((schedule[mid] as number) <= elapsedMs) low = mid + 1;
    else high = mid;
  }
  return low;
}
