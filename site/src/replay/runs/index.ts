import type { ReplayRun } from "../types";
import verified from "./example-verified.json";
import partial from "./example-partial.json";

// JSON imports widen string literals (event types, statuses), so they are cast here once.
// To show a real run, generate its file with scripts/redact-run.ts and swap the import.
export const RUNS: ReplayRun[] = [verified as unknown as ReplayRun, partial as unknown as ReplayRun];
