import { chmod, copyFile, lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  PatchApplication,
  PatchExport,
  WorkspaceCheckpoint,
  WorkspaceErrorCode,
  WorkspaceResult,
  WorkspaceSnapshot,
  WorkspaceState,
} from "./types";

class WorkspaceException extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceException";
  }
}

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function success<T>(value: T): WorkspaceResult<T> {
  return { ok: true, value };
}

function failure(error: unknown): WorkspaceResult<never> {
  if (error instanceof WorkspaceException) {
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

function sha256(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

const MAX_REPLACE_FILE_BYTES = 512 * 1024;

/**
 * Untracked paths that tools generate while installing, building, or testing. They are written
 * to the workspace's own `info/exclude`, so they never count as an edit, never invalidate
 * verification evidence, and never reach `patch.diff`. Files the input already tracks still count.
 */
const GENERATED_ARTIFACT_PATTERNS = [
  "__pycache__/",
  "*.py[cod]",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".tox/",
  ".nox/",
  ".venv/",
  "*.egg-info/",
  ".coverage",
  "node_modules/",
  ".next/",
  ".turbo/",
  ".cache/",
  ".DS_Store",
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missingSegments: string[] = [];
  while (!(await pathExists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    missingSegments.unshift(basename(ancestor));
    ancestor = parent;
  }
  return resolve(await realpath(ancestor), ...missingSegments);
}

// Git metadata belongs to the host. A model edit there could plant config that host git executes.
function touchesGitMetadata(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment.toLowerCase() === ".git");
}

async function workspaceEditPath(root: string, path: string): Promise<string> {
  if (path.trim() === "" || isAbsolute(path)) {
    throw new WorkspaceException("REPLACEMENT_REJECTED", "Replacement path must be a relative repository path.");
  }
  if (touchesGitMetadata(path)) {
    throw new WorkspaceException("REPLACEMENT_REJECTED", `Replacement path must not touch git metadata: ${path}`);
  }
  const target = await canonicalizeProspectivePath(resolve(root, path));
  if (!isInside(root, target)) {
    throw new WorkspaceException("REPLACEMENT_REJECTED", `Replacement path escapes the workspace: ${path}`);
  }
  return target;
}

/**
 * Where host git finds the workspace repository. The git directory lives outside the
 * workspace (and so outside the container mount), and is always passed explicitly so
 * git never discovers a `.git` entry the agent could have created inside the workspace.
 */
interface GitLocation {
  workTree: string;
  gitDir: string;
}

// Defence in depth: even trusted config must not run hooks or an fsmonitor command.
const HARDENED_GIT_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"] as const;

async function runGit(
  cwd: string,
  args: readonly string[],
  input?: string,
  location?: GitLocation,
): Promise<GitResult> {
  const process = Bun.spawn(["git", ...(location === undefined ? [] : HARDENED_GIT_CONFIG), ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GIT_OPTIONAL_LOCKS: "0",
      ...(location === undefined ? {} : { GIT_DIR: location.gitDir, GIT_WORK_TREE: location.workTree }),
    },
  });
  if (input !== undefined && process.stdin !== undefined && typeof process.stdin !== "number") {
    process.stdin.write(input);
    process.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function requireGit(
  cwd: string,
  args: readonly string[],
  input?: string,
  location?: GitLocation,
): Promise<string> {
  const result = await runGit(cwd, args, input, location);
  if (result.exitCode !== 0) {
    throw new WorkspaceException(
      "GIT_ERROR",
      result.stderr.trim() || `git ${args.join(" ")} failed with exit code ${result.exitCode}.`,
    );
  }
  return result.stdout;
}

async function sourceRevision(sourcePath: string): Promise<string | null> {
  const result = await runGit(sourcePath, ["rev-parse", "--verify", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/**
 * Submodule paths (gitlinks, mode 160000). Their contents belong to another repository, so the
 * snapshot keeps the pinned commit from the checkout and does not copy their working tree.
 */
async function submodulePaths(sourcePath: string): Promise<Set<string>> {
  const output = await requireGit(sourcePath, ["ls-files", "--stage", "-z"]);
  const paths = new Set<string>();
  for (const entry of output.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab !== -1 && entry.startsWith("160000 ")) paths.add(entry.slice(tab + 1));
  }
  return paths;
}

async function repositoryFiles(sourcePath: string): Promise<string[]> {
  const output = await requireGit(sourcePath, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const submodules = await submodulePaths(sourcePath);
  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((path) => !submodules.has(path))
    .sort();
}

async function copyRepositoryEntry(sourceRoot: string, targetRoot: string, path: string): Promise<void> {
  const source = resolve(sourceRoot, path);
  const target = resolve(targetRoot, path);
  if (!isInside(sourceRoot, source) || !isInside(targetRoot, target)) {
    throw new WorkspaceException("INVALID_SOURCE", `Repository path escapes its root: ${path}`);
  }

  let sourceStat: Awaited<ReturnType<typeof lstat>>;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await rm(target, { recursive: true, force: true });
      return;
    }
    throw error;
  }

  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  if (sourceStat.isFile()) {
    await copyFile(source, target);
    await chmod(target, sourceStat.mode);
    return;
  }
  if (sourceStat.isSymbolicLink()) {
    const link = await readlink(source);
    if (isAbsolute(link) || !isInside(sourceRoot, resolve(dirname(source), link))) {
      throw new WorkspaceException(
        "UNSUPPORTED_ENTRY",
        `External or absolute symlink is not supported in the input snapshot: ${path}`,
      );
    }
    await symlink(link, target);
    return;
  }
  throw new WorkspaceException(
    "UNSUPPORTED_ENTRY",
    `Only files and internal relative symlinks are supported: ${path}`,
  );
}

async function changedFiles(location: GitLocation, baselineRevision: string): Promise<string[]> {
  await requireGit(location.workTree, ["add", "-A", "--", "."], undefined, location);
  const output = await requireGit(location.workTree, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    baselineRevision,
    "--",
    ".",
  ], undefined, location);
  return output.split("\0").filter(Boolean).sort();
}

async function patchFromBaseline(location: GitLocation, baselineRevision: string): Promise<string> {
  await requireGit(location.workTree, ["add", "-A", "--", "."], undefined, location);
  return await requireGit(location.workTree, [
    "diff",
    "--cached",
    "--binary",
    "--full-index",
    baselineRevision,
    "--",
    ".",
  ], undefined, location);
}

export class IsolatedWorkspace {
  readonly sourcePath: string;
  readonly sourceRevision: string | null;
  readonly workspacePath: string;
  readonly runRoot: string;
  readonly baselineRevision: string;
  readonly gitDir: string;
  private readonly checkpointsPath: string;
  private readonly git: GitLocation;

  private constructor(snapshot: WorkspaceSnapshot) {
    this.sourcePath = snapshot.sourcePath;
    this.sourceRevision = snapshot.sourceRevision;
    this.workspacePath = snapshot.workspacePath;
    this.runRoot = snapshot.runRoot;
    this.baselineRevision = snapshot.baselineRevision;
    this.gitDir = snapshot.gitDir;
    this.git = { workTree: snapshot.workspacePath, gitDir: snapshot.gitDir };
    this.checkpointsPath = resolve(this.runRoot, "checkpoints");
  }

  static async create(options: {
    sourcePath: string;
    runRoot: string;
  }): Promise<WorkspaceResult<IsolatedWorkspace>> {
    let temporaryRoot: string | undefined;
    try {
      const sourcePath = await realpath(resolve(options.sourcePath));
      if (!(await stat(sourcePath)).isDirectory()) {
        throw new WorkspaceException("INVALID_SOURCE", `Source is not a directory: ${sourcePath}`);
      }
      const topLevel = await runGit(sourcePath, ["rev-parse", "--show-toplevel"]);
      if (topLevel.exitCode !== 0 || resolve(topLevel.stdout.trim()) !== sourcePath) {
        throw new WorkspaceException(
          "INVALID_SOURCE",
          `Source must be the root of a Git worktree: ${sourcePath}`,
        );
      }

      const runRoot = await canonicalizeProspectivePath(options.runRoot);
      if (isInside(sourcePath, runRoot)) {
        throw new WorkspaceException(
          "INVALID_OUTPUT",
          "Run output must be outside the source repository.",
        );
      }
      if (await pathExists(runRoot)) {
        throw new WorkspaceException("INVALID_OUTPUT", `Run output already exists: ${runRoot}`);
      }

      await mkdir(dirname(runRoot), { recursive: true });
      temporaryRoot = `${runRoot}.initializing-${crypto.randomUUID()}`;
      const temporaryWorkspace = resolve(temporaryRoot, "workspace");
      const temporaryGitDir = resolve(temporaryRoot, "git");
      await mkdir(temporaryRoot);
      const clone = await runGit(temporaryRoot, [
        "clone",
        "--quiet",
        "--no-hardlinks",
        "--no-checkout",
        `--separate-git-dir=${temporaryGitDir}`,
        sourcePath,
        temporaryWorkspace,
      ]);
      if (clone.exitCode !== 0) {
        throw new WorkspaceException("GIT_ERROR", clone.stderr.trim() || "Unable to clone source.");
      }
      // The clone leaves a `.git` pointer file in the workspace. Remove it: host git is always
      // given GIT_DIR explicitly, and nothing inside the workspace may point at git metadata.
      await rm(resolve(temporaryWorkspace, ".git"), { force: true });
      const location: GitLocation = { workTree: temporaryWorkspace, gitDir: temporaryGitDir };

      const originalRevision = await sourceRevision(sourcePath);
      if (originalRevision !== null) {
        await requireGit(temporaryWorkspace, ["checkout", "--quiet", "--detach", originalRevision], undefined, location);
      }
      for (const path of await repositoryFiles(sourcePath)) {
        await copyRepositoryEntry(sourcePath, temporaryWorkspace, path);
      }

      await mkdir(resolve(temporaryGitDir, "info"), { recursive: true });
      await writeFile(resolve(temporaryGitDir, "info", "exclude"), `${GENERATED_ARTIFACT_PATTERNS.join("\n")}\n`);
      await requireGit(temporaryWorkspace, ["config", "user.name", "Dinner Harness"], undefined, location);
      await requireGit(temporaryWorkspace, ["config", "user.email", "harness@example.invalid"], undefined, location);
      await requireGit(temporaryWorkspace, ["add", "-A", "--", "."], undefined, location);
      await requireGit(temporaryWorkspace, [
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "Dinner input snapshot",
      ], undefined, location);
      const baselineRevision = (
        await requireGit(temporaryWorkspace, ["rev-parse", "HEAD"], undefined, location)
      ).trim();
      await mkdir(resolve(temporaryRoot, "checkpoints"));
      await rename(temporaryRoot, runRoot);
      temporaryRoot = undefined;

      return success(
        new IsolatedWorkspace({
          sourcePath,
          sourceRevision: originalRevision,
          workspacePath: resolve(runRoot, "workspace"),
          gitDir: resolve(runRoot, "git"),
          runRoot,
          baselineRevision,
        }),
      );
    } catch (error) {
      if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
      return failure(error);
    }
  }

  async applyPatch(patch: string): Promise<WorkspaceResult<PatchApplication>> {
    try {
      if (patch.trim() === "") {
        throw new WorkspaceException("PATCH_REJECTED", "Patch must not be empty.");
      }
      const check = await runGit(
        this.workspacePath,
        ["apply", "--check", "--binary", "--whitespace=nowarn", "-"],
        patch,
        this.git,
      );
      if (check.exitCode !== 0) {
        throw new WorkspaceException(
          "PATCH_REJECTED",
          check.stderr.trim() || "Patch does not apply to the current workspace state.",
        );
      }
      const applied = await runGit(
        this.workspacePath,
        ["apply", "--binary", "--whitespace=nowarn", "-"],
        patch,
        this.git,
      );
      if (applied.exitCode !== 0) {
        throw new WorkspaceException(
          "PATCH_REJECTED",
          applied.stderr.trim() || "Patch application failed.",
        );
      }
      return success({ changedFiles: await changedFiles(this.git, this.baselineRevision) });
    } catch (error) {
      return failure(error);
    }
  }

  async replaceFile(path: string, content: string): Promise<WorkspaceResult<PatchApplication>> {
    try {
      if (content.includes("\0")) {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Replacement content must be text.");
      }
      if (Buffer.byteLength(content, "utf8") > MAX_REPLACE_FILE_BYTES) {
        throw new WorkspaceException(
          "REPLACEMENT_REJECTED",
          `Replacement content exceeds ${MAX_REPLACE_FILE_BYTES} bytes.`,
        );
      }

      const target = await workspaceEditPath(this.workspacePath, path);
      let existing: string | null = null;
      if (await pathExists(target)) {
        const targetStat = await lstat(target);
        if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
          throw new WorkspaceException(
            "REPLACEMENT_REJECTED",
            `Replacement target must be a regular file: ${path}`,
          );
        }
        existing = await readFile(target, "utf8");
        if (existing.includes("\0")) {
          throw new WorkspaceException(
            "REPLACEMENT_REJECTED",
            `Replacement target must be a text file: ${path}`,
          );
        }
      }
      if (existing === content) {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Replacement content is unchanged.");
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      return success({ changedFiles: await changedFiles(this.git, this.baselineRevision) });
    } catch (error) {
      return failure(error);
    }
  }

  async replaceText(path: string, search: string, replacement: string): Promise<WorkspaceResult<PatchApplication>> {
    try {
      if (search === "") {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Search text must not be empty.");
      }
      if (search.includes("\0") || replacement.includes("\0")) {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Search and replacement content must be text.");
      }
      const target = await workspaceEditPath(this.workspacePath, path);
      const targetStat = await lstat(target);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new WorkspaceException(
          "REPLACEMENT_REJECTED",
          `Replacement target must be a regular file: ${path}`,
        );
      }
      const existing = await readFile(target, "utf8");
      if (existing.includes("\0")) {
        throw new WorkspaceException(
          "REPLACEMENT_REJECTED",
          `Replacement target must be a text file: ${path}`,
        );
      }
      const first = existing.indexOf(search);
      if (first === -1) {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Search text was not found.");
      }
      if (existing.indexOf(search, first + search.length) !== -1) {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Search text is not unique.");
      }
      const next = `${existing.slice(0, first)}${replacement}${existing.slice(first + search.length)}`;
      if (next === existing) {
        throw new WorkspaceException("REPLACEMENT_REJECTED", "Replacement content is unchanged.");
      }
      await writeFile(target, next);
      return success({ changedFiles: await changedFiles(this.git, this.baselineRevision) });
    } catch (error) {
      return failure(error);
    }
  }

  async createCheckpoint(label: string): Promise<WorkspaceResult<WorkspaceCheckpoint>> {
    try {
      if (label.trim() === "") {
        throw new WorkspaceException("CHECKPOINT_INVALID", "Checkpoint label must not be empty.");
      }
      const patch = await patchFromBaseline(this.git, this.baselineRevision);
      const id = crypto.randomUUID();
      const patchPath = resolve(this.checkpointsPath, `${id}.patch`);
      await writeFile(patchPath, patch, { flag: "wx" });
      return success({
        id,
        label: label.trim(),
        patchPath,
        patchSha256: sha256(patch),
        changedFiles: await changedFiles(this.git, this.baselineRevision),
      });
    } catch (error) {
      return failure(error);
    }
  }

  /**
   * Three git processes and no full diff in memory: stage everything once, hash the tree
   * (a Merkle hash, cheap because git reuses cached index entries), and list changed paths.
   */
  async inspectChanges(): Promise<WorkspaceResult<WorkspaceState>> {
    try {
      await requireGit(this.workspacePath, ["add", "-A", "--", "."], undefined, this.git);
      const fingerprint = (await requireGit(this.workspacePath, ["write-tree"], undefined, this.git)).trim();
      const names = await requireGit(
        this.workspacePath,
        ["diff", "--cached", "--name-only", "-z", this.baselineRevision, "--", "."],
        undefined,
        this.git,
      );
      return success({ fingerprint, changedFiles: names.split("\0").filter(Boolean).sort() });
    } catch (error) {
      return failure(error);
    }
  }

  async restoreCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<WorkspaceResult<PatchApplication>> {
    try {
      const patchPath = resolve(checkpoint.patchPath);
      if (!isInside(this.checkpointsPath, patchPath)) {
        throw new WorkspaceException("CHECKPOINT_INVALID", "Checkpoint path is outside this run.");
      }
      const patch = await readFile(patchPath, "utf8");
      if (sha256(patch) !== checkpoint.patchSha256) {
        throw new WorkspaceException("CHECKPOINT_INVALID", "Checkpoint content hash does not match.");
      }

      await requireGit(this.workspacePath, ["reset", "--hard", "--quiet", this.baselineRevision], undefined, this.git);
      await requireGit(this.workspacePath, ["clean", "-fd", "--quiet"], undefined, this.git);
      if (patch.length > 0) {
        await requireGit(
          this.workspacePath,
          ["apply", "--binary", "--whitespace=nowarn", "-"],
          patch,
          this.git,
        );
      }
      const restoredFiles = await changedFiles(this.git, this.baselineRevision);
      return success({ changedFiles: restoredFiles });
    } catch (error) {
      return failure(error);
    }
  }

  async exportPatch(destination = resolve(this.runRoot, "patch.diff")): Promise<WorkspaceResult<PatchExport>> {
    try {
      const patchPath = await canonicalizeProspectivePath(destination);
      if (!isInside(this.runRoot, patchPath) || isInside(this.workspacePath, patchPath)) {
        throw new WorkspaceException(
          "INVALID_OUTPUT",
          "Patch export must be inside the run output and outside the target workspace.",
        );
      }
      const patch = await patchFromBaseline(this.git, this.baselineRevision);
      await mkdir(dirname(patchPath), { recursive: true });
      await writeFile(patchPath, patch);
      return success({
        patchPath,
        patchSha256: sha256(patch),
        changedFiles: await changedFiles(this.git, this.baselineRevision),
        bytes: Buffer.byteLength(patch),
      });
    } catch (error) {
      return failure(error);
    }
  }
}
