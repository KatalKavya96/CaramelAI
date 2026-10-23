import type { AgentEvent } from "@core/agent/types";
import type { AgentRunResult } from "@core/agent/types";
import type { ReplayRun } from "../src/replay/types";

export interface RedactOptions {
  id: string;
  label: string;
  /** Public URL of the repository the run worked on; replaces local paths in the output. */
  repoUrl: string;
  model: string;
  /** Extra literal strings to scrub, such as a username or an internal hostname. */
  extraSecrets?: string[];
  /** Longest command-output preview kept, in lines. */
  maxOutputLines?: number;
  /** Longest string kept anywhere else (file contents in replace_file, long patches). */
  maxStringLength?: number;
}

// Shapes of common credentials. The core already redacts the key it was given; these catch any
// other secret a command printed (a token in a .env the tests read, a URL with a password).
const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /(?<=Bearer\s)[A-Za-z0-9._~+/=-]{16,}/g,
  /(?<=:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/g,
];

// Home directories in any OS's spelling, so "/Users/kavya/..." does not leak a username.
const HOME_PATTERNS: RegExp[] = [/\/Users\/[^/\s"']+/g, /\/home\/[^/\s"']+/g, /[A-Z]:\\Users\\[^\\\s"']+/g];

function escape(literal: string): RegExp {
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
}

/** Builds the string scrubber: run-specific paths first (longest first), then generic patterns. */
export function makeScrubber(paths: string[], extraSecrets: string[] = []): (text: string) => string {
  const literals = [...new Set([...paths, ...extraSecrets].filter((value) => value.trim().length >= 3))]
    .sort((a, b) => b.length - a.length)
    .map((value) => ({ pattern: escape(value), replacement: paths.includes(value) ? placeholderFor(value, paths) : "[redacted]" }));
  return (text) => {
    let out = text;
    for (const { pattern, replacement } of literals) out = out.replace(pattern, replacement);
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
    for (const pattern of HOME_PATTERNS) out = out.replace(pattern, "~");
    return out;
  };
}

function placeholderFor(path: string, paths: string[]): string {
  return path === paths[0] ? "<workspace>" : "<repo>";
}

function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return { text: `${lines.slice(0, maxLines).join("\n")}\n…`, truncated: true };
}

/** Deep-maps every string through the scrubber and caps its length. */
function scrubDeep(value: unknown, scrub: (text: string) => string, maxLength: number): unknown {
  if (typeof value === "string") {
    const clean = scrub(value);
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
  }
  if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry, scrub, maxLength));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubDeep(entry, scrub, maxLength)]));
  }
  return value;
}

/**
 * Keeps only what the replay shows from a tool result: success, exit code, duration and a short
 * output preview. File contents a read_file returned, directory listings and search hits are
 * dropped, because the page never shows them and they are where private code would leak.
 */
function slimResult(result: unknown, maxOutputLines: number): unknown {
  if (typeof result !== "object" || result === null) return result;
  const value = result as Record<string, unknown>;
  const slim: Record<string, unknown> = {};
  if ("ok" in value) slim.ok = value.ok;
  if (typeof value.error === "string" || (typeof value.error === "object" && value.error !== null)) slim.error = value.error;
  if (typeof value.exitCode === "number") slim.exitCode = value.exitCode;
  if (typeof value.durationMs === "number") slim.durationMs = value.durationMs;
  for (const stream of ["stdout", "stderr"] as const) {
    const preview = (value[stream] as { preview?: unknown } | undefined)?.preview;
    if (typeof preview === "string") {
      const cut = truncateLines(preview, maxOutputLines);
      const wasTruncated = (value[stream] as { previewTruncated?: unknown }).previewTruncated === true;
      slim[stream] = { preview: cut.text, previewTruncated: wasTruncated || cut.truncated };
    }
  }
  return slim;
}

export interface RunFiles {
  eventsJsonl: string;
  result: AgentRunResult;
  patch: string;
}

/** Turns a run's raw output into the public ReplayRun the landing page plays. */
export function redactRun(files: RunFiles, options: RedactOptions): ReplayRun {
  const { result } = files;
  const maxOutputLines = options.maxOutputLines ?? 24;
  const maxStringLength = options.maxStringLength ?? 4000;
  const scrub = makeScrubber([result.workspacePath, result.sourceRepo], options.extraSecrets);
  const clean = <T>(value: T): T => scrubDeep(value, scrub, maxStringLength) as T;

  const events = files.eventsJsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AgentEvent)
    .map((event): AgentEvent => {
      switch (event.type) {
        case "run_started":
          return clean({ ...event, payload: { ...event.payload, sourceRepo: options.repoUrl, workspacePath: "<workspace>" } });
        case "tool_result": {
          const payload = { ...event.payload };
          if (payload.result !== undefined) payload.result = slimResult(payload.result, maxOutputLines);
          return clean({ ...event, payload });
        }
        default:
          return clean(event);
      }
    });

  const evidence = result.verification.evidence.map(({ stdoutLogPath: _out, stderrLogPath: _err, ...rest }) => clean(rest));

  return {
    id: options.id,
    label: options.label,
    provenance: "recorded",
    repoUrl: options.repoUrl,
    model: options.model,
    recordedAt: events[0]?.timestamp ?? new Date().toISOString(),
    status: result.status,
    summary: clean(result.summary),
    terminationReason: clean(result.terminationReason),
    events,
    evidence,
    patch: scrub(files.patch),
    metrics: {
      steps: result.metrics.steps,
      modelCalls: result.metrics.modelCalls,
      commandsRun: result.metrics.commandsRun,
      durationMs: result.metrics.durationMs,
    },
    usage: result.usage,
  };
}
