import { createReadStream } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  FileListEntry,
  FileListResult,
  FileReadResult,
  RepositoryDiff,
  RepositoryMetadata,
  RepositoryToolErrorCode,
  RepositoryToolResult,
  SearchMatch,
  SearchResult,
} from "./types";

export interface RepositoryToolLimits {
  maxListEntries?: number;
  maxListDepth?: number;
  maxReadLines?: number;
  maxOutputBytes?: number;
  maxSearchResults?: number;
  maxSearchFiles?: number;
  maxSearchFileBytes?: number;
}

const DEFAULT_LIMITS: Required<RepositoryToolLimits> = {
  maxListEntries: 500,
  maxListDepth: 6,
  maxReadLines: 400,
  maxOutputBytes: 64 * 1024,
  maxSearchResults: 100,
  maxSearchFiles: 2_000,
  maxSearchFileBytes: 1024 * 1024,
};

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".harness-runs",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

const MANIFEST_CANDIDATES = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "Pipfile",
  "poetry.lock",
  "Cargo.toml",
  "go.mod",
];

const TEST_CONFIG_CANDIDATES = [
  "bunfig.toml",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.js",
  "vitest.config.ts",
  "pytest.ini",
  "tox.ini",
  "setup.cfg",
];

class RepositoryToolException extends Error {
  constructor(
    readonly code: RepositoryToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryToolException";
  }
}

interface ResolvedRepositoryPath {
  absolutePath: string;
  displayPath: string;
}

interface CapturedProcess {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

function success<T>(value: T): RepositoryToolResult<T> {
  return { ok: true, value };
}

function failure(error: unknown): RepositoryToolResult<never> {
  if (error instanceof RepositoryToolException) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: "IO_ERROR", message: detail } };
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RepositoryToolException("INVALID_ARGUMENT", `${name} must be a positive integer.`);
  }
  return value;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function appendWithinLimit(current: string, addition: string, limit: number): [string, boolean] {
  const available = limit - byteLength(current);
  if (available <= 0) return [current, true];
  if (byteLength(addition) <= available) return [current + addition, false];
  return [current + Buffer.from(addition).subarray(0, available).toString("utf8"), true];
}

async function isBinaryFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function captureStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<{
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

async function runGit(
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

export class RepositoryTools {
  private constructor(
    readonly rootPath: string,
    private readonly limits: Required<RepositoryToolLimits>,
    private readonly gitDir: string | undefined,
  ) {}

  /**
   * `options.gitDir` points git at metadata kept outside `rootPath` (an isolated workspace).
   * Without it, git discovers the repository from `rootPath` as usual.
   */
  static async create(
    rootPath: string,
    limits: RepositoryToolLimits = {},
    options: { gitDir?: string } = {},
  ): Promise<RepositoryTools> {
    const canonicalRoot = await realpath(resolve(rootPath));
    if (!(await stat(canonicalRoot)).isDirectory()) {
      throw new RepositoryToolException("NOT_A_DIRECTORY", `Not a directory: ${canonicalRoot}`);
    }
    const merged = { ...DEFAULT_LIMITS, ...limits };
    return new RepositoryTools(canonicalRoot, {
      maxListEntries: positiveInteger(merged.maxListEntries, "maxListEntries"),
      maxListDepth: positiveInteger(merged.maxListDepth, "maxListDepth"),
      maxReadLines: positiveInteger(merged.maxReadLines, "maxReadLines"),
      maxOutputBytes: positiveInteger(merged.maxOutputBytes, "maxOutputBytes"),
      maxSearchResults: positiveInteger(merged.maxSearchResults, "maxSearchResults"),
      maxSearchFiles: positiveInteger(merged.maxSearchFiles, "maxSearchFiles"),
      maxSearchFileBytes: positiveInteger(merged.maxSearchFileBytes, "maxSearchFileBytes"),
    }, options.gitDir === undefined ? undefined : await realpath(resolve(options.gitDir)));
  }

  async listFiles(options: { path?: string; maxDepth?: number } = {}): Promise<RepositoryToolResult<FileListResult>> {
    try {
      const start = await this.resolveExistingPath(options.path ?? ".");
      const depthLimit = Math.min(
        positiveInteger(options.maxDepth ?? this.limits.maxListDepth, "maxDepth"),
        this.limits.maxListDepth,
      );
      const entries: FileListEntry[] = [];
      let truncated = false;

      const visit = async (absolutePath: string, displayPath: string, depth: number): Promise<void> => {
        if (entries.length >= this.limits.maxListEntries) {
          truncated = true;
          return;
        }

        const pathStat = await lstat(absolutePath);
        if (pathStat.isSymbolicLink()) {
          entries.push({ path: displayPath, type: "symlink" });
          return;
        }
        if (pathStat.isFile()) {
          entries.push({ path: displayPath, type: "file" });
          return;
        }
        if (!pathStat.isDirectory()) return;

        if (displayPath !== ".") entries.push({ path: displayPath, type: "directory" });
        if (depth >= depthLimit) {
          if ((await readdir(absolutePath)).length > 0) truncated = true;
          return;
        }

        const children = await readdir(absolutePath, { withFileTypes: true });
        children.sort((left, right) => left.name.localeCompare(right.name));
        for (const child of children) {
          if (EXCLUDED_DIRECTORIES.has(child.name)) continue;
          const childDisplay = displayPath === "." ? child.name : `${displayPath}/${child.name}`;
          await visit(resolve(absolutePath, child.name), childDisplay, depth + 1);
          if (entries.length >= this.limits.maxListEntries) {
            truncated = true;
            break;
          }
        }
      };

      await visit(start.absolutePath, start.displayPath, 0);
      return success({
        entries,
        truncated,
        ...(truncated ? { notice: "[truncated: file listing limit reached]" } : {}),
      });
    } catch (error) {
      return failure(error);
    }
  }

  async readFile(options: {
    path: string;
    startLine?: number;
    endLine?: number;
  }): Promise<RepositoryToolResult<FileReadResult>> {
    try {
      const target = await this.resolveExistingPath(options.path);
      if (!(await stat(target.absolutePath)).isFile()) {
        throw new RepositoryToolException("NOT_A_FILE", `Not a file: ${options.path}`);
      }
      if (await isBinaryFile(target.absolutePath)) {
        throw new RepositoryToolException("BINARY_FILE", `Binary file cannot be read as text: ${options.path}`);
      }

      const startLine = positiveInteger(options.startLine ?? 1, "startLine");
      const requestedEnd = options.endLine ?? startLine + this.limits.maxReadLines - 1;
      if (!Number.isInteger(requestedEnd) || requestedEnd < startLine) {
        throw new RepositoryToolException(
          "INVALID_PATH",
          "endLine must be an integer greater than or equal to startLine.",
        );
      }
      const effectiveEnd = Math.min(requestedEnd, startLine + this.limits.maxReadLines - 1);
      let content = "";
      let lastIncludedLine = startLine - 1;
      let observedLines = 0;
      let stoppedEarly = false;

      const lines = createInterface({
        input: createReadStream(target.absolutePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        observedLines += 1;
        if (observedLines < startLine) continue;
        if (observedLines > effectiveEnd) {
          stoppedEarly = true;
          lines.close();
          break;
        }
        const [nextContent, hitByteLimit] = appendWithinLimit(
          content,
          `${line}\n`,
          this.limits.maxOutputBytes,
        );
        content = nextContent;
        lastIncludedLine = observedLines;
        if (hitByteLimit) {
          stoppedEarly = true;
          lines.close();
          break;
        }
      }

      const truncated = stoppedEarly || effectiveEnd < requestedEnd;
      return success({
        path: target.displayPath,
        content,
        startLine,
        endLine: lastIncludedLine,
        totalLines: stoppedEarly ? null : observedLines,
        truncated,
        ...(truncated ? { notice: "[truncated: requested range or output limit reached]" } : {}),
      });
    } catch (error) {
      return failure(error);
    }
  }

  async search(options: {
    query: string;
    path?: string;
    maxResults?: number;
  }): Promise<RepositoryToolResult<SearchResult>> {
    try {
      if (options.query.length === 0) {
        throw new RepositoryToolException("INVALID_PATH", "Search query must not be empty.");
      }
      const start = await this.resolveExistingPath(options.path ?? ".");
      const requestedLimit = positiveInteger(
        options.maxResults ?? this.limits.maxSearchResults,
        "maxResults",
      );
      const resultLimit = Math.min(requestedLimit, this.limits.maxSearchResults);
      const files = await this.collectSearchFiles(start, this.limits.maxSearchFiles + 1);
      const fileLimitReached = files.length > this.limits.maxSearchFiles;
      const matches: SearchMatch[] = [];
      let filesScanned = 0;
      let filesSkippedAsBinary = 0;
      let filesSkippedAsLarge = 0;
      let resultLimitReached = false;

      for (const file of files.slice(0, this.limits.maxSearchFiles)) {
        const fileStat = await stat(file.absolutePath);
        if (fileStat.size > this.limits.maxSearchFileBytes) {
          filesSkippedAsLarge += 1;
          continue;
        }
        if (await isBinaryFile(file.absolutePath)) {
          filesSkippedAsBinary += 1;
          continue;
        }
        filesScanned += 1;
        const text = await Bun.file(file.absolutePath).text();
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          const column = line.indexOf(options.query);
          if (column === -1) continue;
          matches.push({
            path: file.displayPath,
            line: index + 1,
            column: column + 1,
            preview: line.slice(0, 500),
          });
          if (matches.length >= resultLimit) {
            resultLimitReached = true;
            break;
          }
        }
        if (resultLimitReached) break;
      }

      const truncated = fileLimitReached || resultLimitReached || requestedLimit > resultLimit;
      return success({
        matches,
        filesScanned,
        filesSkippedAsBinary,
        filesSkippedAsLarge,
        truncated,
        ...(truncated ? { notice: "[truncated: search file or result limit reached]" } : {}),
      });
    } catch (error) {
      return failure(error);
    }
  }

  async inspectDiff(): Promise<RepositoryToolResult<RepositoryDiff>> {
    try {
      await this.assertGitRepository();
      const head = await runGit(this.rootPath, ["rev-parse", "--verify", "HEAD"], 1_024, this.gitDir);
      const diffCommands =
        head.exitCode === 0
          ? [["diff", "HEAD", "--no-ext-diff", "--binary", "--", "."]]
          : [
              ["diff", "--cached", "--no-ext-diff", "--binary", "--", "."],
              ["diff", "--no-ext-diff", "--binary", "--", "."],
            ];
      const [diffs, untracked] = await Promise.all([
        Promise.all(
          diffCommands.map((args) => runGit(this.rootPath, args, this.limits.maxOutputBytes, this.gitDir)),
        ),
        runGit(
          this.rootPath,
          ["ls-files", "--others", "--exclude-standard", "-z"],
          this.limits.maxOutputBytes,
          this.gitDir,
        ),
      ]);
      const failedDiff = diffs.find((diff) => diff.exitCode !== 0);
      if (failedDiff !== undefined) {
        throw new RepositoryToolException(
          "GIT_ERROR",
          failedDiff.stderr.trim() || "git diff failed.",
        );
      }
      if (untracked.exitCode !== 0) {
        throw new RepositoryToolException(
          "GIT_ERROR",
          untracked.stderr.trim() || "Unable to list untracked files.",
        );
      }
      let trackedPatch = "";
      let combinedOutputTruncated = false;
      for (const diff of diffs) {
        const appended = appendWithinLimit(
          trackedPatch,
          diff.stdout,
          this.limits.maxOutputBytes,
        );
        trackedPatch = appended[0];
        combinedOutputTruncated ||= appended[1] || diff.truncated;
      }
      const truncated = combinedOutputTruncated || untracked.truncated;
      return success({
        trackedPatch,
        untrackedFiles: untracked.stdout.split("\0").filter(Boolean).sort(),
        truncated,
        ...(truncated ? { notice: "[truncated: diff output limit reached]" } : {}),
      });
    } catch (error) {
      return failure(error);
    }
  }

  async metadata(): Promise<RepositoryToolResult<RepositoryMetadata>> {
    try {
      await this.assertGitRepository();
      const [revision, branch, status] = await Promise.all([
        runGit(this.rootPath, ["rev-parse", "--verify", "HEAD"], 1_024, this.gitDir),
        runGit(this.rootPath, ["branch", "--show-current"], 1_024, this.gitDir),
        runGit(this.rootPath, ["status", "--porcelain=v1", "-z"], this.limits.maxOutputBytes, this.gitDir),
      ]);
      if (status.exitCode !== 0) {
        throw new RepositoryToolException("GIT_ERROR", status.stderr.trim() || "git status failed.");
      }

      return success({
        rootPath: this.rootPath,
        startRevision: revision.exitCode === 0 ? revision.stdout.trim() : null,
        branch: branch.exitCode === 0 && branch.stdout.trim() !== "" ? branch.stdout.trim() : null,
        dirty: status.stdout.length > 0,
        statusEntries: status.stdout.split("\0").filter(Boolean),
        manifests: await this.existingCandidates(MANIFEST_CANDIDATES),
        testConfigs: await this.existingCandidates(TEST_CONFIG_CANDIDATES),
        statusTruncated: status.truncated,
      });
    } catch (error) {
      return failure(error);
    }
  }

  private async resolveExistingPath(inputPath: string): Promise<ResolvedRepositoryPath> {
    if (inputPath.trim() === "" || isAbsolute(inputPath)) {
      throw new RepositoryToolException("INVALID_PATH", "Repository tool paths must be relative.");
    }
    const lexicalPath = resolve(this.rootPath, inputPath);
    if (!isInside(this.rootPath, lexicalPath)) {
      throw new RepositoryToolException("PATH_ESCAPE", `Path escapes repository root: ${inputPath}`);
    }

    let canonicalPath: string;
    try {
      canonicalPath = await realpath(lexicalPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new RepositoryToolException("NOT_FOUND", `Path does not exist: ${inputPath}`);
      }
      throw error;
    }
    if (!isInside(this.rootPath, canonicalPath)) {
      throw new RepositoryToolException("PATH_ESCAPE", `Symlink escapes repository root: ${inputPath}`);
    }
    const displayPath = relative(this.rootPath, lexicalPath).split(sep).join("/") || ".";
    return { absolutePath: canonicalPath, displayPath };
  }

  private async collectSearchFiles(
    start: ResolvedRepositoryPath,
    limit: number,
  ): Promise<ResolvedRepositoryPath[]> {
    const startStat = await lstat(start.absolutePath);
    if (startStat.isFile()) return [start];
    if (!startStat.isDirectory()) {
      throw new RepositoryToolException("NOT_A_DIRECTORY", `Not searchable: ${start.displayPath}`);
    }

    const files: ResolvedRepositoryPath[] = [];
    const visit = async (directory: string, displayPath: string): Promise<void> => {
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (files.length >= limit) return;
        if (EXCLUDED_DIRECTORIES.has(child.name)) continue;
        if (child.isSymbolicLink()) continue;
        const childDisplay = displayPath === "." ? child.name : `${displayPath}/${child.name}`;
        const childAbsolute = resolve(directory, child.name);
        if (child.isDirectory()) await visit(childAbsolute, childDisplay);
        else if (child.isFile()) files.push({ absolutePath: childAbsolute, displayPath: childDisplay });
      }
    };
    await visit(start.absolutePath, start.displayPath);
    return files;
  }

  private async assertGitRepository(): Promise<void> {
    const topLevel = await runGit(this.rootPath, ["rev-parse", "--show-toplevel"], 4_096, this.gitDir);
    if (topLevel.exitCode !== 0 || resolve(topLevel.stdout.trim()) !== this.rootPath) {
      throw new RepositoryToolException(
        "NOT_A_GIT_REPOSITORY",
        `Repository root is not a Git worktree root: ${this.rootPath}`,
      );
    }
  }

  private async existingCandidates(candidates: string[]): Promise<string[]> {
    const existing: string[] = [];
    for (const candidate of candidates) {
      try {
        if ((await stat(resolve(this.rootPath, candidate))).isFile()) existing.push(candidate);
      } catch {
        // Candidate is absent or unreadable; it is not advertised.
      }
    }
    return existing;
  }
}
