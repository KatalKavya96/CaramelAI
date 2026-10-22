import { realpath, stat } from "node:fs/promises";
import type { RepoSource } from "./run-request";

const CLONE_TIMEOUT_MS = 120_000;

/**
 * Makes the repository a run works on available as a local git worktree. A git URL is cloned
 * shallowly into `targetPath` with only https allowed, no credential prompts, no hooks and no
 * submodules, so a hostile URL or repository cannot reach other protocols or run code here.
 */
export async function prepareRepository(source: RepoSource, targetPath: string, signal?: AbortSignal): Promise<string> {
  if (source.kind === "local") {
    // The agent works on a snapshot of this folder; the folder itself is only read.
    const path = await realpath(source.path).catch(() => null);
    if (path === null || !(await stat(path)).isDirectory()) throw new Error(`Folder not found: ${source.path}`);
    return path;
  }
  const args = [
    "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always",
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.fsmonitor=false",
    "clone", "--quiet", "--depth", "1", "--no-recurse-submodules",
    ...(source.ref === undefined ? [] : ["--branch", source.ref]),
    "--", source.url, targetPath,
  ];
  const process = Bun.spawn(["git", ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", GIT_CONFIG_NOSYSTEM: "1" },
  });
  const stop = () => process.kill();
  const timer = setTimeout(stop, CLONE_TIMEOUT_MS);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const [stderr, exitCode] = await Promise.all([new Response(process.stderr).text(), process.exited]);
    if (signal?.aborted === true) throw new Error("Clone cancelled.");
    if (exitCode !== 0) throw new Error(`Could not clone ${source.url}: ${stderr.trim() || `git exited ${exitCode}`}`);
    return targetPath;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
