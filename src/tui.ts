import { readSync } from "node:fs";
import type { AgentEvent, AgentRunResult } from "./agent";

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const CYAN = "\u001b[36m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const MAGENTA = "\u001b[35m";
const RED = "\u001b[31m";

const CARAMEL = "\u001b[38;5;208m";
const GOLD = "\u001b[38;5;214m";
const CREAM = "\u001b[38;5;223m";
const BROWN = "\u001b[38;5;130m";
const MUTED = "\u001b[38;5;244m";
const BG_DARK = "\u001b[48;5;232m";


function paint(enabled: boolean, code: string, value: string): string {
  return enabled ? `${code}${value}${RESET}` : value;
}

function visibleLength(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function truncate(value: string, max: number): string {
  if (visibleLength(value) <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function box(title: string, lines: readonly string[], options: { color?: boolean; width?: number } = {}): string {
  const color = options.color ?? true;
  const width = Math.max(48, options.width ?? 86);
  const inner = width - 4;
  const header = ` ${title} `;
  const top = `╭${header}${"─".repeat(Math.max(0, width - 2 - visibleLength(header)))}╮`;
  const body = lines.map((line) => {
    const clipped = truncate(line, inner);
    return `│ ${clipped}${" ".repeat(Math.max(0, inner - visibleLength(clipped)))} │`;
  });
  const bottom = `╰${"─".repeat(width - 2)}╯`;
  return [paint(color, CYAN, top), ...body, paint(color, CYAN, bottom)].join("\n");
}

export function renderSplash(options: { color?: boolean } = {}): string {
  const color = options.color ?? true;

  const c = (code: string, value: string) => paint(color, code, value);

  const logo = [
    " ██████╗ █████╗ ██████╗  █████╗ ███╗   ███╗███████╗██╗     ",
    "██╔════╝██╔══██╗██╔══██╗██╔══██╗████╗ ████║██╔════╝██║     ",
    "██║     ███████║██████╔╝███████║██╔████╔██║█████╗  ██║     ",
    "██║     ██╔══██║██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║     ",
    "╚██████╗██║  ██║██║  ██║██║  ██║██║ ╚═╝ ██║███████╗███████╗",
    " ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚══════╝",
  ];

  const popcorn = [
    "                 ╭──────╮",
    "            ╭────╯▒▒▒▒▒▒╰──╮",
    "         ╭──╯▒▒▒▒▒▒▒▒▒▒▒▒▒╰──╮",
    "       ╭─╯▒▒▒▒  ░░▒▒░░  ▒▒▒▒▒╰─╮",
    "      │▒▒░░  ●  ░▒▒▒░  ●  ░░▒▒│",
    "      │▒▒▒▒░░░▒▒▒▒▒▒▒▒░░░▒▒▒▒│",
    "       ╰─────────╥──────────────╯",
    "                 ║",
    "                 ║  caramel",
    "                 ║  drizzle",
    "              ╭──╨──╮",
    "          ✦  (  ● ●  )  ✦",
    "        ✦  ( ● ● ● ● ● )",
    "       (● ● ● ● ● ● ● ●)",
    "      ╭──────────────────╮",
    "      │ ░█░█░█░█░█░█░█░ │",
    "      │ █░█░█░█░█░█░█░█ │",
    "      │ ░█░█░  ◉  ░█░█░ │",
    "      │ █░█░█░█░█░█░█░█ │",
    "      ╰──────────────────╯",
  ];

  const tools = [
    ["repo_scope",      "clone, inspect, read, patch",       "work with repositories"],
    ["caramel_search",  "search files, symbols, context",   "find what matters"],
    ["kernel_exec",     "run commands and tooling",         "execute with confidence"],
    ["code_studio",     "edit, patch, refactor",            "build and improve code"],
    ["test_crunch",     "run tests, lint, verify",          "evidence over claims"],
    ["memory_jar",      "remember findings and failures",   "keep context useful"],
    ["checkpoint",      "save, restore, recover",           "safe experimentation"],
    ["diff_inspect",    "review final changes",             "verify before finish"],
  ] as const;

  const skills = [
    ["plan_and_breakdown",   "turn issues into actionable plans"],
    ["repo_understanding",   "locate relevant code quickly"],
    ["debug_and_fix",        "diagnose failures and repair"],
    ["context_management",   "keep only useful information"],
    ["failure_recovery",     "adapt instead of repeating"],
    ["verification",         "prove the change actually works"],
  ] as const;

  const WIDTH = 118;
  const line = "─".repeat(WIDTH - 2);

  const row = (left: string, right = "") => {
    const gap = Math.max(1, WIDTH - 4 - visibleLength(left) - visibleLength(right));
    return `│ ${left}${" ".repeat(gap)}${right} │`;
  };

  const out: string[] = [];

  out.push(c(CARAMEL, `╭${line}╮`));
  out.push(row(
    c(GOLD, "●  ●  ●   ›_  ~/caramel"),
    c(GOLD, "Caramél Agent v0.1.0")
  ));
  out.push(c(CARAMEL, `├${line}┤`));

  const logoWidth = Math.max(...logo.map(visibleLength));

  for (let i = 0; i < logo.length; i++) {
    const left = popcorn[i] ?? "";
    const center = logo[i] ?? "";
    const tagline = [
      "PLAN.",
      "BUILD.",
      "VERIFY.",
      "ENJOY.",
      "",
      "AI Coding Harness",
    ][i] ?? "";

    const leftCol = left.padEnd(31);
    const centerCol = c(GOLD, center.padEnd(logoWidth));
    const rightCol = c(CARAMEL, tagline);

    out.push(row(`${c(CARAMEL, leftCol)}   ${centerCol}`, rightCol));
  }

  for (let i = logo.length; i < popcorn.length; i++) {
    out.push(row(c(CARAMEL, popcorn[i] ?? "")));
  }

  out.push(row(""));
  out.push(row(
    c(CREAM, "                     ✦  AI AGENT FOR SWEETER SOFTWARE WORKFLOWS  ✦")
  ));
  out.push(row(""));

  out.push(row(
    c(GOLD, "  🔧 Available Tools  ") +
    c(BROWN, "──────────────────────────────────────────────────────────────────────────────")
  ));

  for (const [name, capability, note] of tools) {
    const left =
      `  ${c(GOLD, name.padEnd(18))} : ` +
      `${c(CREAM, capability.padEnd(34))} ` +
      `${c(MUTED, "// " + note)}`;

    out.push(row(left));
  }

  out.push(row(""));

  out.push(row(
    c(GOLD, "  ✦ Available Skills ") +
    c(BROWN, "──────────────────────────────────────────────────────────────────────────────")
  ));

  for (const [name, capability] of skills) {
    const left =
      `  ${c(GOLD, name.padEnd(22))} : ` +
      `${c(CREAM, capability.padEnd(43))}`;

    out.push(row(left));
  }

  out.push(row(""));
  out.push(c(CARAMEL, `├${line}┤`));

  const cwd = process.cwd().replace(process.env.HOME ?? "", "~");

  out.push(row(
    `${c(GOLD, "caramel@agent")}   │   📁 ${c(CREAM, cwd)}`,
    `${c(GOLD, "⚡ SWEETER CODE. VERIFIED OUTCOMES.")}`
  ));

  out.push(c(CARAMEL, `╰${line}╯`));

  out.push("");
  out.push(c(MUTED, "Caramel AI Coding Harness"));
  out.push(c(MUTED, "Press Enter to configure a coding run."));

  return out.join("\n");
}

function valueOf(payload: unknown, key: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>)[key];
}

function actionType(payload: unknown): string {
  const action = valueOf(payload, "action");
  if (typeof action === "object" && action !== null) {
    const type = (action as Record<string, unknown>).type;
    if (typeof type === "string") return type;
  }
  const flat = valueOf(payload, "action");
  return typeof flat === "string" ? flat : "unknown";
}

function changedFiles(payload: unknown): string[] {
  const result = valueOf(payload, "result");
  if (typeof result !== "object" || result === null) return [];
  const value = (result as Record<string, unknown>).value;
  if (typeof value !== "object" || value === null) return [];
  const files = (value as Record<string, unknown>).changedFiles;
  return Array.isArray(files) ? files.filter((item): item is string => typeof item === "string") : [];
}

export function createTuiEventRenderer(
  write: (message: string) => void = console.log,
  options: { color?: boolean } = {},
): (event: AgentEvent) => void {
  const color = options.color ?? true;
  return (event) => {
    if (event.type === "run_started") {
      const workspace = valueOf(event.payload, "workspacePath");
      write(box("Run started", [
        `${paint(color, GREEN, "●")} Workspace: ${String(workspace ?? "unknown")}`,
        "The agent will inspect, edit, verify, inspect diff, then finish.",
      ], { color }));
      return;
    }

    if (event.type === "model_decision") {
      const intent = valueOf(event.payload, "intent");
      const type = actionType(event.payload);
      write(box(`Step ${event.sequence} · model`, [
        `${paint(color, MAGENTA, "thinking")}: ${String(intent ?? "choosing next action")}`,
        `${paint(color, CYAN, "action")}: ${type}`,
      ], { color }));
      return;
    }

    if (event.type === "model_error") {
      const kind = valueOf(event.payload, "kind");
      const message = valueOf(event.payload, "message");
      write(box(`Step ${event.sequence} · model error`, [
        `${paint(color, RED, "kind")}: ${String(kind ?? "unknown")}`,
        `${paint(color, RED, "message")}: ${String(message ?? "unknown")}`,
      ], { color }));
      return;
    }

    if (event.type === "tool_result") {
      const action = valueOf(event.payload, "action");
      const workspaceChanged = valueOf(event.payload, "workspaceChanged") === true;
      const files = changedFiles(event.payload);
      const result = valueOf(event.payload, "result");
      const ok = typeof result === "object" && result !== null && (result as Record<string, unknown>).ok !== false;
      write(box(`Step ${event.sequence} · result`, [
        `${workspaceChanged ? paint(color, GREEN, "changed") : paint(color, YELLOW, "unchanged")}: ${String(action ?? "unknown")}`,
        `status: ${ok ? "ok" : "blocked/rejected"}`,
        files.length > 0 ? `files: ${files.join(", ")}` : "files: none",
      ], { color }));
      return;
    }

    if (event.type === "run_finished") {
      const status = valueOf(event.payload, "status");
      const reason = valueOf(event.payload, "terminationReason");
      const files = valueOf(event.payload, "changedFiles");
      write(box(`Run finished · ${String(status ?? "unknown")}`, [
        `reason: ${String(reason ?? "completed")}`,
        `changed files: ${Array.isArray(files) ? files.join(", ") || "none" : "unknown"}`,
      ], { color }));
    }
  };
}

export function renderRunSummary(result: AgentRunResult, options: { color?: boolean } = {}): string {
  const color = options.color ?? true;
  return box("Final evidence", [
    `status: ${result.status}`,
    `reason: ${result.terminationReason}`,
    `changed files: ${result.changedFiles.join(", ") || "none"}`,
    `checks: ${result.verification.commandsRun}`,
    `tokens: ${result.usage.providerTotalTokens || result.usage.estimatedTotalTokens}`,
    `patch: ${result.patchPath}`,
    `report: ${result.reportPath}`,
  ], { color });
}


export interface SelectChoice {
  label: string;
  value: string;
  hint?: string;
}

export type TerminalSelector = (
  title: string,
  choices: readonly SelectChoice[],
  options?: { defaultIndex?: number; help?: string },
) => string | null;

export function renderSelectMenu(
  title: string,
  choices: readonly SelectChoice[],
  selectedIndex: number,
  options: { color?: boolean; help?: string } = {},
): string {
  const color = options.color ?? true;
  const lines = [
    options.help ?? "Use ↑/↓ and Enter to select.",
    "",
    ...choices.map((choice, index) => {
      const selected = index === selectedIndex;
      const marker = selected ? "›" : " ";
      const label = selected ? paint(color, BOLD, choice.label) : choice.label;
      const hint = choice.hint ? paint(color, DIM, `  ${choice.hint}`) : "";
      return `${marker} ${label}${hint}`;
    }),
  ];
  return box(title, lines, { color, width: 92 });
}

export function createArrowKeySelector(options: {
  color?: boolean;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
} = {}): TerminalSelector {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const color = options.color ?? true;

  return (title, choices, selectOptions = {}) => {
    if (choices.length === 0) return null;
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
      return choices[selectOptions.defaultIndex ?? 0]?.value ?? null;
    }

    let selected = Math.min(Math.max(selectOptions.defaultIndex ?? 0, 0), choices.length - 1);
    const render = () => {
      output.write("\u001b[2J\u001b[3J\u001b[H");
      output.write(renderSelectMenu(title, choices, selected, {
        color,
        ...(selectOptions.help === undefined ? {} : { help: selectOptions.help }),
      }));
      output.write("\n");
    };

    const previousRawMode = input.isRaw;
    output.write("\u001b[?1049h\u001b[?25l");
    input.setRawMode(true);
    input.resume();
    render();

    const buffer = Buffer.alloc(8);
    try {
      while (true) {
        const fd = (input as { fd?: number }).fd ?? 0;
        const read = readSync(fd, buffer, 0, buffer.length, null);
        const chunk = buffer.subarray(0, read).toString("utf8");

        if (chunk === "\u0003") throw new Error("Interactive selection cancelled.");
        if (chunk === "\r" || chunk === "\n") return choices[selected]?.value ?? null;
        if (chunk === "\u001b[A" || chunk === "k") {
          selected = selected === 0 ? choices.length - 1 : selected - 1;
          render();
        } else if (chunk === "\u001b[B" || chunk === "j") {
          selected = selected === choices.length - 1 ? 0 : selected + 1;
          render();
        } else if (/^[1-9]$/.test(chunk)) {
          const index = Number(chunk) - 1;
          if (index >= 0 && index < choices.length) {
            selected = index;
            render();
          }
        }
      }
    } finally {
      input.setRawMode(previousRawMode);
      output.write("\u001b[?25h\u001b[?1049l");
    }
  };
}
