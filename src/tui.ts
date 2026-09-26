import { readSync } from "node:fs";
import type { AgentEvent, AgentPlan, AgentRunResult, PlanQuestion } from "./agent";

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const INVERSE = "\u001b[7m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const MAGENTA = "\u001b[35m";
const CYAN = "\u001b[36m";
const RED = "\u001b[31m";

// Caramél palette — close to the reference image.
const GOLD = "\u001b[38;5;220m";
const AMBER = "\u001b[38;5;214m";
const ORANGE = "\u001b[38;5;208m";
const CREAM = "\u001b[38;5;223m";
const SOFT = "\u001b[38;5;250m";
const MUTED = "\u001b[38;5;244m";
const DARK = "\u001b[38;5;236m";

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function paint(enabled: boolean, code: string, value: string): string {
  return enabled ? `${code}${value}${RESET}` : value;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

function visibleLength(value: string): number {
  return [...stripAnsi(value)].length;
}

function padRight(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (visibleLength(value) <= max) return value;
  const plain = stripAnsi(value);
  return plain.slice(0, Math.max(0, max - 1)) + "…";
}

function centerText(value: string, width: number): string {
  const left = Math.max(0, Math.floor((width - visibleLength(value)) / 2));
  return " ".repeat(left) + value;
}

function fit(value: string, width: number): string {
  const clipped = truncate(value, width);
  return padRight(clipped, width);
}

function hr(width: number, ch = "─"): string {
  return ch.repeat(Math.max(0, width));
}

function joinColumns(left: string[], right: string[], leftWidth: number, gap = 2): string[] {
  const rows = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    out.push(`${fit(l, leftWidth)}${" ".repeat(gap)}${r}`);
  }
  return out;
}

function panel(title: string, rows: string[], width: number, color: boolean): string[] {
  const c = (code: string, v: string) => paint(color, code, v);
  const inner = width - 2;
  const topTitle = ` ${title} `;
  const top = `╭${topTitle}${hr(inner - visibleLength(topTitle))}╮`;
  const body = rows.map((row) => `│${fit(` ${row}`, inner)}│`);
  const bottom = `╰${hr(inner)}╯`;
  return [c(ORANGE, top), ...body, c(ORANGE, bottom)];
}

export function box(
  title: string,
  lines: readonly string[],
  options: { color?: boolean; width?: number } = {},
): string {
  const color = options.color ?? true;
  const width = Math.max(48, options.width ?? 86);
  const inner = width - 4;
  const header = ` ${title} `;
  const top = `╭${header}${hr(width - 2 - visibleLength(header))}╮`;
  const body = lines.map((line) => {
    const clipped = truncate(line, inner);
    return `│ ${fit(clipped, inner)} │`;
  });
  const bottom = `╰${hr(width - 2)}╯`;
  return [paint(color, ORANGE, top), ...body, paint(color, ORANGE, bottom)].join("\n");
}

const LOGO = [
  " ██████╗ █████╗ ██████╗  █████╗ ███╗   ███╗███████╗██╗     ",
  "██╔════╝██╔══██╗██╔══██╗██╔══██╗████╗ ████║██╔════╝██║     ",
  "██║     ███████║██████╔╝███████║██╔████╔██║█████╗  ██║     ",
  "██║     ██╔══██║██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║     ",
  "╚██████╗██║  ██║██║  ██║██║  ██║██║ ╚═╝ ██║███████╗███████╗",
  " ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚══════╝",
];

const TOOLS = [
  ["search", "web, docs, research, real-time info"],
  ["code", "read, write, edit, refactor"],
  ["execute", "run commands, notebooks, scripts"],
  ["browse", "open browser, click, fill, automate"],
  ["files", "manage files and directories"],
  ["git", "clone, commit, push, PR"],
  ["deploy", "build, deploy, monitor"],
  ["database", "query, analyze, manage"],
  ["apis", "integrate and test APIs"],
  ["tools", "extensions and custom tools"],
  ["memory", "remember context and preferences"],
] as const;

const SKILLS = [
  ["planning", "break down tasks, create roadmap"],
  ["coding", "full-stack, scripts, automation"],
  ["debugging", "diagnose, fix, improve"],
  ["research", "deep research, summarise, compare"],
  ["data", "analyze, clean, visualize"],
  ["automation", "workflows, pipelines, integrations"],
  ["documentation", "write docs, README, guides"],
  ["testing", "tests, lint, eval, improve quality"],
  ["learning", "adapt to your style and codebase"],
  ["reasoning", "multi-step problem solving"],
  ["collaboration", "work with your tools and team"],
] as const;

const QUICK = ["New Task", "Continue", "Settings", "Tools", "Help"] as const;

export interface SplashOptions {
  color?: boolean | undefined;
  width?: number | undefined;
  selectedQuickIndex?: number | undefined;
  cwd?: string | undefined;
  version?: string | undefined;
}

function renderHero(width: number, color: boolean): string[] {
  const c = (code: string, v: string) => paint(color, code, v);
  const heroRight = [
    "",
    `${c(CREAM, "plan")}  ${c(AMBER, ">")}  ${c(CREAM, "think")}  ${c(AMBER, ">")}  ${c(CREAM, "code")}  ${c(AMBER, ">")}  ${c(CREAM, "execute")}  ${c(AMBER, ">")}  ${c(CREAM, "ship")}`,
    "",
    c(SOFT, "Your coding, research and automation"),
    c(SOFT, "companion — with a sweeter taste."),
  ];

  if (width < 100) {
    const compact = [
      ...LOGO.slice(0, 6).map((x) => c(GOLD, x)),
      c(GOLD, centerText("──  A I   A G E N T   F O R   S W E E T E R   W O R K F L O W S  ──", Math.min(width, 78))),
      "",
      ...heroRight,
    ];
    return compact;
  }

  const leftWidth = Math.min(74, Math.floor(width * 0.64));
  const rightWidth = Math.max(30, width - leftWidth - 4);
  const logo = LOGO.map((x) => c(GOLD, x));
  const left = [
    ...logo,
    c(GOLD, centerText("──  A I   A G E N T   F O R   S W E E T E R   W O R K F L O W S  ──", leftWidth)),
  ];
  const divider = c(ORANGE, "│");
  const right = heroRight.map((x) => truncate(x, rightWidth - 2));
  const rows = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    out.push(`${fit(l, leftWidth)} ${divider} ${r}`);
  }
  return out;
}

function renderInfoPanels(width: number, color: boolean): string[] {
  const c = (code: string, v: string) => paint(color, code, v);
  const toolRows = TOOLS.map(
    ([name, desc]) => `${c(GOLD, ">  " + name.padEnd(14))}${c(ORANGE, ":")}  ${c(MUTED, desc)}`,
  );
  const skillRows = SKILLS.map(
    ([name, desc]) => `${c(GOLD, ">  " + name.padEnd(16))}${c(ORANGE, ":")}  ${c(MUTED, desc)}`,
  );

  if (width >= 108) {
    const gap = 2;
    const leftWidth = Math.floor((width - gap) / 2);
    const rightWidth = width - gap - leftWidth;
    return joinColumns(
      panel("[ AVAILABLE TOOLS ]", toolRows, leftWidth, color),
      panel("[ AVAILABLE SKILLS ]", skillRows, rightWidth, color),
      leftWidth,
      gap,
    );
  }

  return [
    ...panel("[ AVAILABLE TOOLS ]", toolRows, width, color),
    "",
    ...panel("[ AVAILABLE SKILLS ]", skillRows, width, color),
  ];
}

function renderQuickStart(width: number, selected: number, color: boolean): string[] {
  const c = (code: string, v: string) => paint(color, code, v);
  const title = c(GOLD, "[ QUICK START ]");

  if (width < 84) {
    const rows = QUICK.map((label, i) => {
      const active = i === selected;
      const prefix = active ? c(GOLD, "›") : " ";
      const number = c(GOLD, String(i + 1));
      const text = active ? c(BOLD + GOLD, label) : c(CREAM, label);
      return `${prefix} ${number}  ${text}`;
    });
    return panel("[ QUICK START ]", rows, width, color);
  }

  const inner = width - 2;
  const topTitle = ` ${title} `;
  const out = [c(ORANGE, `╭${topTitle}${hr(inner - visibleLength(topTitle))}╮`)];

  const gaps = "  │  ";
  const available = inner - 2 - visibleLength(gaps) * (QUICK.length - 1);
  const buttonWidth = Math.max(11, Math.floor(available / QUICK.length));
  const buttons = QUICK.map((label, i) => {
    const content = `${i + 1}  ${label}`;
    const centered = centerText(content, buttonWidth);
    if (i === selected) {
      return c(BOLD + GOLD, `▰${fit(centered, buttonWidth - 2)}▰`);
    }
    return c(ORANGE, `╭${hr(buttonWidth - 2)}╮`) + "\n" +
      c(CREAM, `│${fit(centered, buttonWidth - 2)}│`) + "\n" +
      c(ORANGE, `╰${hr(buttonWidth - 2)}╯`);
  });

  const split = buttons.map((b) => b.split("\n"));
  for (let row = 0; row < 3; row++) {
    const pieces = split.map((part) => part[row] ?? fit("", buttonWidth));
    out.push(`│ ${pieces.join(c(DARK, gaps))}${" ".repeat(Math.max(0, inner - 1 - visibleLength(pieces.join(gaps))))}│`);
  }
  out.push(c(ORANGE, `╰${hr(inner)}╯`));
  return out;
}

export function renderSplash(options: SplashOptions = {}): string {
  const color = options.color ?? true;
  const c = (code: string, v: string) => paint(color, code, v);
  const terminalWidth = options.width ?? process.stdout.columns ?? 120;
  const width = Math.max(68, Math.min(170, terminalWidth - 2));
  const inner = width - 2;
  const selected = Math.min(Math.max(options.selectedQuickIndex ?? 0, 0), QUICK.length - 1);
  const version = options.version ?? "v0.1.0";
  const cwd = options.cwd ?? process.cwd().replace(process.env.HOME ?? "", "~");

  const out: string[] = [];
  const top = `╭${hr(inner)}╮`;
  out.push(c(ORANGE, top));

  const topLeft = `${c(GOLD, "●")} ${c(ORANGE, "●")} ${c(RED, "●")}    ${c(GOLD, "~/caramel")}`;
  const topRight = c(GOLD, `Caramél Agent   ${version}`);
  const topGap = Math.max(1, inner - 2 - visibleLength(topLeft) - visibleLength(topRight));
  out.push(`│ ${topLeft}${" ".repeat(topGap)}${topRight} │`);
  out.push(c(ORANGE, `├${hr(inner)}┤`));

  for (const line of renderHero(inner - 2, color)) {
    out.push(`│ ${fit(line, inner - 2)} │`);
  }

  out.push(`│ ${fit("", inner - 2)} │`);

  for (const line of renderInfoPanels(inner - 2, color)) {
    out.push(`│ ${fit(line, inner - 2)} │`);
  }

  out.push(`│ ${fit("", inner - 2)} │`);

  for (const line of renderQuickStart(inner - 2, selected, color)) {
    out.push(`│ ${fit(line, inner - 2)} │`);
  }

  out.push(c(ORANGE, `├${hr(inner)}┤`));
  const statusLeft = `${c(GOLD, "caramel@agent")}  ${c(ORANGE, "│")}  ${c(CREAM, cwd)}  ${c(ORANGE, "│")}  ${c(GOLD, ">")} ${c(CREAM, "▌")}`;
  const statusRight = `${c(GOLD, "sweeter ideas, faster execution")} ${c(ORANGE, "✦")}`;
  const statusGap = Math.max(1, inner - 2 - visibleLength(statusLeft) - visibleLength(statusRight));
  out.push(`│ ${truncate(statusLeft, Math.max(1, inner - 3))}${" ".repeat(statusGap)}${truncate(statusRight, Math.max(0, inner - visibleLength(statusLeft) - statusGap - 2))} │`);
  out.push(c(ORANGE, `╰${hr(inner)}╯`));
  out.push("");
  out.push(c(MUTED, "Caramel AI Coding Harness"));

  return out.join("\n");
}

export type HomeAction = "new" | "continue" | "settings" | "tools" | "help";

export function createCaramelHomeSelector(options: {
  color?: boolean;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  cwd?: string;
  version?: string;
} = {}): () => HomeAction | null {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const color = options.color ?? true;
  const values: HomeAction[] = ["new", "continue", "settings", "tools", "help"];

  return () => {
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
      return "new";
    }

    let selected = 0;
    const previousRawMode = input.isRaw;
    const buffer = Buffer.alloc(16);

    const render = () => {
      output.write("\u001b[2J\u001b[3J\u001b[H");
      output.write(renderSplash({
        color,
        width: output.columns,
        selectedQuickIndex: selected,
        cwd: options.cwd,
        version: options.version,
      }));
      output.write("\n");
    };

    output.write("\u001b[?1049h\u001b[?25l");
    input.setRawMode(true);
    input.resume();
    render();

    try {
      while (true) {
        const fd = (input as { fd?: number }).fd ?? 0;
        const read = readSync(fd, buffer, 0, buffer.length, null);
        if (read <= 0) continue;
        const chunk = buffer.subarray(0, read).toString("utf8");

        if (chunk === "\u0003") return null;
        if (chunk === "\r" || chunk === "\n") return values[selected] ?? null;
        if (chunk === "\u001b") return null;

        if (chunk === "\u001b[D" || chunk === "h" || chunk === "\u001b[A" || chunk === "k") {
          selected = selected === 0 ? QUICK.length - 1 : selected - 1;
          render();
          continue;
        }
        if (chunk === "\u001b[C" || chunk === "l" || chunk === "\u001b[B" || chunk === "j") {
          selected = selected === QUICK.length - 1 ? 0 : selected + 1;
          render();
          continue;
        }
        if (/^[1-5]$/.test(chunk)) {
          selected = Number(chunk) - 1;
          render();
          continue;
        }
      }
    } finally {
      input.setRawMode(previousRawMode);
      output.write("\u001b[?25h\u001b[?1049l");
    }
  };
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
  return typeof action === "string" ? action : "unknown";
}

function changedFiles(payload: unknown): string[] {
  const result = valueOf(payload, "result");
  if (typeof result !== "object" || result === null) return [];
  const value = (result as Record<string, unknown>).value;
  if (typeof value !== "object" || value === null) return [];
  const files = (value as Record<string, unknown>).changedFiles;
  return Array.isArray(files)
    ? files.filter((item): item is string => typeof item === "string")
    : [];
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
        `${paint(color, GOLD, "action")}: ${type}`,
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
      const ok = typeof result === "object" && result !== null &&
        (result as Record<string, unknown>).ok !== false;
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

export function renderRunSummary(
  result: AgentRunResult,
  options: { color?: boolean } = {},
): string {
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
  hint?: string | undefined;
}

export type TerminalSelector = (
  title: string,
  choices: readonly SelectChoice[],
  options?: { defaultIndex?: number | undefined; help?: string | undefined },
) => string | null;

export function renderSelectMenu(
  title: string,
  choices: readonly SelectChoice[],
  selectedIndex: number,
  options: { color?: boolean; help?: string; width?: number } = {},
): string {
  const color = options.color ?? true;
  const lines = [
    options.help ?? "Use ↑/↓ and Enter to select.",
    "",
    ...choices.map((choice, index) => {
      const selected = index === selectedIndex;
      const marker = selected ? paint(color, GOLD, "›") : " ";
      const label = selected ? paint(color, BOLD + GOLD, choice.label) : choice.label;
      const hint = choice.hint ? paint(color, DIM + MUTED, `  ${choice.hint}`) : "";
      return `${marker} ${label}${hint}`;
    }),
  ];
  return box(title, lines, { color, width: options.width ?? Math.min(92, process.stdout.columns ?? 92) });
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
        width: output.columns,
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

        if (chunk === "\u0003" || chunk === "\u001b") return null;
        if (chunk === "\r" || chunk === "\n") return choices[selected]?.value ?? null;
        if (chunk === "\u001b[A" || chunk === "k" || chunk === "\u001b[D" || chunk === "h") {
          selected = selected === 0 ? choices.length - 1 : selected - 1;
          render();
        } else if (chunk === "\u001b[B" || chunk === "j" || chunk === "\u001b[C" || chunk === "l") {
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

export function renderPlanSummary(plan: { summary: string }, options: { color?: boolean } = {}): string {
  const color = options.color ?? true;
  return box("Plan", [
    paint(color, BOLD, "Agent's proposed approach:"),
    "",
    ...plan.summary.split("\n").map((line) => `  ${line}`),
    "",
    paint(color, DIM, "The agent will now ask clarifying questions."),
    paint(color, DIM, "Use ↑/↓ to select or type a custom answer."),
  ], { color, width: 92 });
}

export function renderPlanApproval(plan: AgentPlan, options: { color?: boolean } = {}): string {
  const color = options.color ?? true;
  const answerLines = plan.answers.map((answer) =>
    `  ${paint(color, CYAN, "•")} ${answer.question}: ${paint(color, BOLD, answer.answer)}${answer.isCustom ? paint(color, DIM, " (custom)") : ""}`
  );
  return box("Plan Summary", [
    paint(color, BOLD, plan.summary),
    "",
    paint(color, GREEN, "Your decisions:"),
    ...answerLines,
  ], { color, width: 92 });
}

export function planQuestionToSelectChoices(question: PlanQuestion): SelectChoice[] {
  const choices: SelectChoice[] = question.options.map((option, index) => ({
    label: option,
    value: option,
    ...(index === (question.defaultIndex ?? 0) ? { hint: "recommended" } : {}),
  }));
  if (question.allowCustom) {
    choices.push({
      label: "✎ Custom answer…",
      value: "__plan_custom_answer__",
      hint: "type your own",
    });
  }
  return choices;
}
