/** Running git inside a repository the agent is working on, with output capped and repository hooks disabled. */
export interface CapturedProcess {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export async function captureStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<{
  text: string;
  truncated: boolean;
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesKept = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (bytesKept < limit) {
      const remaining = limit - bytesKept;
      const kept = value.subarray(0, remaining);
      text += decoder.decode(kept, { stream: true });
      bytesKept += kept.byteLength;
      if (kept.byteLength < value.byteLength) truncated = true;
    } else {
      truncated = true;
    }
  }
  text += decoder.decode();
  return { text, truncated };
}

// Defence in depth: never run hooks or an fsmonitor command from repository config.
const HARDENED_GIT_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"] as const;

export async function runGit(
  root: string,
  args: string[],
  outputLimit: number,
  gitDir: string | undefined,
): Promise<CapturedProcess> {
  const process = Bun.spawn(["git", ...HARDENED_GIT_CONFIG, ...args], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GIT_OPTIONAL_LOCKS: "0",
      ...(gitDir === undefined ? {} : { GIT_DIR: gitDir, GIT_WORK_TREE: root }),
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    captureStream(process.stdout, outputLimit),
    captureStream(process.stderr, outputLimit),
    process.exited,
  ]);
  return {
    exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
  };
}
