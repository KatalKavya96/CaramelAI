import type { ModelAction, RepoSource } from "./contract";

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** mm:ss clock for a live elapsed counter. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${Math.round(count / 100) / 10}k`.replace(".0k", "k");
  return `${Math.round(count / 100_000) / 10}M`;
}

/** "Today, 10:24 AM", "Apr 24, 2026", matching the search mockup. */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export type DateGroup = "Today" | "Previous 7 days" | "Older";

export function dateGroup(iso: string, now = new Date()): DateGroup {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return "Today";
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  return days <= 7 ? "Previous 7 days" : "Older";
}

/** "acme/api" from "https://github.com/acme/api(.git)"; the folder name from a local path. */
export function repoLabel(url: string): string {
  if (url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url)) {
    const parts = url.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts.at(-1) || url;
  }
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    return path === "" ? url : path;
  } catch {
    return url;
  }
}

/** First line of a task, for titles. */
export function taskTitle(task: string, max = 80): string {
  const line = task.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The target of an action, shown next to its name in the step list. */
export function describeAction(action: ModelAction): string {
  switch (action.type) {
    case "list_files":
      return action.path ?? ".";
    case "search":
      return `"${action.query}"${action.path === undefined ? "" : ` in ${action.path}`}`;
    case "read_file":
      return action.startLine === undefined ? action.path : `${action.path}:${action.startLine}-${action.endLine ?? ""}`;
    case "apply_patch":
      return patchedFiles(action.patch).join(", ") || "patch";
    case "replace_text":
    case "replace_file":
      return action.path;
    case "create_checkpoint":
      return action.label;
    case "restore_checkpoint":
      return action.checkpointId;
    case "run_command":
      return action.command;
    case "inspect_diff":
      return "workspace diff";
    case "finish":
      return taskTitle(action.summary, 120);
  }
}

/** Files named by a unified diff's +++ lines. */
export function patchedFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    const match = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (match?.[1] !== undefined && match[1] !== "/dev/null") files.push(match[1].trim());
  }
  return files;
}

/** The URL (or path, for a local run) a request points at. */
export function sourceUrl(repo: RepoSource): string {
  return repo.kind === "git" ? repo.url : repo.path;
}

/** The ref a git request pins, if any. */
export function sourceRef(repo: RepoSource): string | undefined {
  return repo.kind === "git" ? repo.ref : undefined;
}
