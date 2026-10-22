import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryTools } from "../src/tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryDirectory(prefix = "dinner-repo-"): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

async function gitRepository(): Promise<string> {
  const root = await temporaryDirectory();
  git(root, ["init", "-q"]);
  await writeFile(join(root, "package.json"), '{"scripts":{"test":"bun test"}}\n');
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "math.ts"), "export const add = (a: number, b: number) => a + b;\n");
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Dinner Tests", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  return root;
}

describe("RepositoryTools paths and listing", () => {
  test("lists deterministically while excluding generated directories", async () => {
    const root = await gitRepository();
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "ignored.js"), "ignored");
    const tools = await RepositoryTools.create(root);

    const result = await tools.listFiles();
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.entries.map((entry) => entry.path)).toEqual([
      "package.json",
      "src",
      "src/math.ts",
    ]);
    expect(result.value.truncated).toBeFalse();
  });

  test("marks a capped listing as truncated", async () => {
    const root = await gitRepository();
    const tools = await RepositoryTools.create(root, { maxListEntries: 2 });

    const result = await tools.listFiles();
    expect(result.ok && result.value.truncated).toBeTrue();
    if (result.ok) expect(result.value.notice).toContain("truncated");
  });

  test("rejects traversal and symlinks that escape the root", async () => {
    const root = await gitRepository();
    const outside = await temporaryDirectory("dinner-outside-");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "escaped.txt"));
    const tools = await RepositoryTools.create(root);

    expect(await tools.listFiles({ path: ".." })).toMatchObject({
      ok: false,
      error: { code: "PATH_ESCAPE" },
    });
    expect(await tools.readFile({ path: "../secret.txt" })).toMatchObject({
      ok: false,
      error: { code: "PATH_ESCAPE" },
    });
    expect(await tools.readFile({ path: "escaped.txt" })).toMatchObject({
      ok: false,
      error: { code: "PATH_ESCAPE" },
    });
  });
});

describe("RepositoryTools text inspection", () => {
  test("reads bounded line ranges and exposes truncation", async () => {
    const root = await gitRepository();
    await writeFile(join(root, "many.txt"), "one\ntwo\nthree\nfour\n");
    const tools = await RepositoryTools.create(root, { maxReadLines: 2 });

    const result = await tools.readFile({ path: "many.txt", startLine: 2, endLine: 4 });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.content).toBe("two\nthree\n");
    expect(result.value.truncated).toBeTrue();
    expect(result.value.totalLines).toBeNull();
    expect(result.value.notice).toContain("truncated");
  });

  test("caps text output by UTF-8 byte size", async () => {
    const root = await gitRepository();
    await writeFile(join(root, "wide.txt"), "abcdefghij\n");
    const tools = await RepositoryTools.create(root, { maxOutputBytes: 5 });

    const result = await tools.readFile({ path: "wide.txt" });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(Buffer.byteLength(result.value.content)).toBeLessThanOrEqual(5);
    expect(result.value.truncated).toBeTrue();
  });

  test("rejects binary and missing files explicitly", async () => {
    const root = await gitRepository();
    await writeFile(join(root, "binary.dat"), Buffer.from([1, 0, 2]));
    const tools = await RepositoryTools.create(root);

    expect(await tools.readFile({ path: "binary.dat" })).toMatchObject({
      ok: false,
      error: { code: "BINARY_FILE" },
    });
    expect(await tools.readFile({ path: "missing.txt" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  test("searches literal text with locations and skips binary content", async () => {
    const root = await gitRepository();
    await writeFile(join(root, "src", "other.ts"), "const refreshToken = true;\n");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 114, 101, 102]));
    const tools = await RepositoryTools.create(root);

    const result = await tools.search({ query: "refreshToken" });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.matches).toEqual([
      { path: "src/other.ts", line: 1, column: 7, preview: "const refreshToken = true;" },
    ]);
    expect(result.value.filesSkippedAsBinary).toBe(1);
  });
});

describe("RepositoryTools Git inspection", () => {
  test("records clean and dirty repository metadata", async () => {
    const root = await gitRepository();
    const tools = await RepositoryTools.create(root);
    const clean = await tools.metadata();

    expect(clean.ok).toBeTrue();
    if (!clean.ok) return;
    expect(clean.value.startRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.value.dirty).toBeFalse();
    expect(clean.value.manifests).toContain("package.json");

    await writeFile(join(root, "src", "math.ts"), "export const add = () => 0;\n");
    const dirty = await tools.metadata();
    expect(dirty.ok && dirty.value.dirty).toBeTrue();
  });

  test("reports tracked patches and untracked files", async () => {
    const root = await gitRepository();
    await writeFile(join(root, "src", "math.ts"), "export const add = () => 0;\n");
    await writeFile(join(root, "new.txt"), "new\n");
    const tools = await RepositoryTools.create(root);

    const result = await tools.inspectDiff();
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.value.trackedPatch).toContain("export const add = () => 0;");
    expect(result.value.untrackedFiles).toEqual(["new.txt"]);
  });

  test("handles an empty Git repository without inventing a revision", async () => {
    const root = await temporaryDirectory();
    git(root, ["init", "-q"]);
    const tools = await RepositoryTools.create(root);

    const result = await tools.metadata();
    expect(result.ok).toBeTrue();
    if (result.ok) expect(result.value.startRevision).toBeNull();

    const diff = await tools.inspectDiff();
    expect(diff).toEqual({
      ok: true,
      value: { trackedPatch: "", untrackedFiles: [], truncated: false },
    });
  });

  test("returns a typed failure outside a Git repository", async () => {
    const root = await temporaryDirectory();
    const tools = await RepositoryTools.create(root);

    expect(await tools.metadata()).toMatchObject({
      ok: false,
      error: { code: "NOT_A_GIT_REPOSITORY" },
    });
  });
});

describe("RepositoryTools diff base", () => {
  test("diffs against the pinned base revision even when HEAD moves", async () => {
    const root = await gitRepository();
    const base = git(root, ["rev-parse", "HEAD"]).trim();
    await writeFile(join(root, "src", "math.ts"), "export const add = (a: number, b: number) => a - b;\n");
    git(root, ["-c", "user.name=Dinner Tests", "-c", "user.email=test@example.invalid", "commit", "-qam", "moved head"]);

    const tools = await RepositoryTools.create(root, {}, { baseRevision: base });
    const diff = await tools.inspectDiff();
    if (!diff.ok) throw new Error(diff.error.message);
    expect(diff.value.trackedPatch).toContain("-export const add = (a: number, b: number) => a + b;");
  });
});
