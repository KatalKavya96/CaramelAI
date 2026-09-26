import { basename } from "node:path";
import type { AgentEvent } from "./types";

export function defaultRunId(outputPath: string): string {
  return basename(outputPath);
}

function compactText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…[truncated ${value.length - maxChars} chars]`;
}

function compactForTerminal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactForTerminal);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (
    record.ok === true &&
    typeof record.value === "object" &&
    record.value !== null &&
    typeof (record.value as { content?: unknown }).content === "string"
  ) {
    const read = record.value as Record<string, unknown>;
    const content = read.content as string;
    return {
      ...record,
      value: {
        ...read,
        content: compactText(content, 900),
        contentChars: content.length,
      },
    };
  }
  if (
    typeof record.preview === "string" &&
    typeof record.capturedBytes === "number"
  ) {
    return {
      ...record,
      preview: compactText(record.preview, 900),
      previewChars: record.preview.length,
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, compactForTerminal(nested)]),
  );
}

export function createAgentEventRenderer(
  write: (message: string) => void = console.log,
  options: { color?: boolean } = {},
): (event: AgentEvent) => void {
  const color = options.color ?? true;
  const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const pretty = (value: unknown) => JSON.stringify(compactForTerminal(value), null, 2);
  const heading = (event: AgentEvent, marker: string, label: string) =>
    `[${String(event.sequence).padStart(3, "0")}] ${marker} ${label}`;

  return (event) => {
    if (event.type === "run_started") {
      write(`${paint(36, heading(event, "▶", "RUN STARTED"))}\n${pretty(event.payload)}`);
    }
    if (event.type === "model_decision") {
      const payload = event.payload as { action?: { type?: unknown }; intent?: unknown };
      write(`${paint(35, heading(event, "◆", `MODEL → ${String(payload.action?.type)}`))}\n${pretty(payload)}`);
    }
    if (event.type === "model_error") {
      write(`${paint(31, heading(event, "!", "MODEL ERROR"))}\n${pretty(event.payload)}`);
    }
    if (event.type === "tool_result") {
      const payload = event.payload as { action?: unknown; workspaceChanged?: unknown };
      const changed = payload.workspaceChanged === true ? "changed" : "unchanged";
      write(`${paint(36, heading(event, "●", `RESULT ← ${String(payload.action)} (${changed})`))}\n${pretty(payload)}`);
    }
    if (event.type === "run_finished") {
      const payload = event.payload as { status?: unknown };
      const code = payload.status === "verified" ? 32 : 33;
      write(`${paint(code, heading(event, "■", `RUN FINISHED: ${String(payload.status)}`))}\n${pretty(payload)}`);
    }
  };
}

export function renderAgentEvent(event: AgentEvent): void {
  createAgentEventRenderer()(event);
}
