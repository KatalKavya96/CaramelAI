import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsolatedWorkspace } from "../src/workspace";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function git(root: string, args: string[], input?: string): string {
  const process = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (process.exitCode !== 0) throw new Error(process.stderr.toString());
  return process.stdout.toString();
}

async function sourceRepository(): Promise<string> {
  const source = await temporaryDirectory("dinner-source-");
  git(source, ["init", "-q"]);
  await writeFile(join(source, "a.txt"), "alpha\n");
  await writeFile(join(source, "delete.txt"), "remove me\n");
  git(source, ["add", "."]);
  git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial"]);
  return source;
}

async function createWorkspace(source: string): Promise<IsolatedWorkspace> {
  const parent = await temporaryDirectory("dinner-run-parent-");
  const result = await IsolatedWorkspace.create({ sourcePath: source, runRoot: join(parent, "run") });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const CHANGE_ALPHA_TO_BETA = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-alpha
+beta
`;

describe("IsolatedWorkspace initialization", () => {
  test("snapshots dirty and untracked input without changing the source", async () => {
    const source = await sourceRepository();
    await writeFile(join(source, "a.txt"), "input dirty state\n");
    await writeFile(join(source, "notes.txt"), "untracked input\n");
    const sourceStatusBefore = git(source, ["status", "--porcelain=v1"]);

    const workspace = await createWorkspace(source);

    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("input dirty state\n");
    expect(await readFile(join(workspace.workspacePath, "notes.txt"), "utf8")).toBe("untracked input\n");
    expect(git(workspace.workspacePath, [`--git-dir=${workspace.gitDir}`, "--work-tree=.", "status", "--porcelain=v1"])).toBe("");
    expect(git(source, ["status", "--porcelain=v1"])).toBe(sourceStatusBefore);
    expect(workspace.sourceRevision).not.toBe(workspace.baselineRevision);
  });

  test("rejects output inside the source and existing output", async () => {
    const source = await sourceRepository();
    const inside = await IsolatedWorkspace.create({
      sourcePath: source,
      runRoot: join(source, ".harness-runs", "run"),
    });
    expect(inside).toMatchObject({ ok: false, error: { code: "INVALID_OUTPUT" } });
    expect(existsSync(join(source, ".harness-runs"))).toBeFalse();

    const existing = await temporaryDirectory("dinner-existing-");
    const collision = await IsolatedWorkspace.create({ sourcePath: source, runRoot: existing });
    expect(collision).toMatchObject({ ok: false, error: { code: "INVALID_OUTPUT" } });
  });

  test("preserves internal relative symlinks and rejects external ones", async () => {
    const source = await sourceRepository();
    await symlink("a.txt", join(source, "internal-link"));
    git(source, ["add", "internal-link"]);
    const workspace = await createWorkspace(source);
    expect(await readlink(join(workspace.workspacePath, "internal-link"))).toBe("a.txt");

    const secondSource = await sourceRepository();
    const outside = await temporaryDirectory("dinner-link-target-");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(secondSource, "external-link"));
    git(secondSource, ["add", "external-link"]);
    const parent = await temporaryDirectory("dinner-run-parent-");
    const rejected = await IsolatedWorkspace.create({
      sourcePath: secondSource,
      runRoot: join(parent, "run"),
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_ENTRY" } });
  });
});

describe("IsolatedWorkspace snapshot overlay", () => {
  const commit = (root: string, message: string) =>
    git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message]);

  test("reproduces staged, unstaged, deleted, untracked and dir-to-file changes exactly", async () => {
    const source = await sourceRepository();
    await mkdir(join(source, "dir"));
    await writeFile(join(source, "dir", "inner.txt"), "inner\n");
    await writeFile(join(source, "staged.txt"), "v1\n");
    git(source, ["add", "."]);
    commit(source, "more");

    await writeFile(join(source, "staged.txt"), "v2 staged\n");
    git(source, ["add", "staged.txt"]);
    await writeFile(join(source, "a.txt"), "unstaged edit\n");
    await rm(join(source, "delete.txt"));
    await writeFile(join(source, "new.txt"), "untracked\n");
    await rm(join(source, "dir"), { recursive: true });
    await writeFile(join(source, "dir"), "now a file\n");

    const workspace = await createWorkspace(source);
    const read = (path: string) => readFile(join(workspace.workspacePath, path), "utf8");
    expect(await read("staged.txt")).toBe("v2 staged\n");
    expect(await read("a.txt")).toBe("unstaged edit\n");
    expect(existsSync(join(workspace.workspacePath, "delete.txt"))).toBeFalse();
    expect(await read("new.txt")).toBe("untracked\n");
    expect(await read("dir")).toBe("now a file\n");
  });

  test("rejects a committed external symlink even though it is not copied", async () => {
    const source = await sourceRepository();
    const outside = await temporaryDirectory("dinner-link-target-");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(source, "external-link"));
    git(source, ["add", "external-link"]);
    commit(source, "link");

    const parent = await temporaryDirectory("dinner-run-parent-");
    const result = await IsolatedWorkspace.create({ sourcePath: source, runRoot: join(parent, "run") });
    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_ENTRY" } });
  });
});

describe("IsolatedWorkspace patching", () => {
  test("applies a patch only to the isolated copy", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);

    const result = await workspace.applyPatch(CHANGE_ALPHA_TO_BETA);
    expect(result).toEqual({ ok: true, value: { changedFiles: ["a.txt"] } });
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("beta\n");
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("alpha\n");
  });

  test("rejects stale and path-escaping patches", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    const stale = CHANGE_ALPHA_TO_BETA.replace("-alpha", "-not-current");
    expect(await workspace.applyPatch(stale)).toMatchObject({
      ok: false,
      error: { code: "PATCH_REJECTED" },
    });
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("alpha\n");

    const escaping = `diff --git a/../outside.txt b/../outside.txt
--- a/../outside.txt
+++ b/../outside.txt
@@ -0,0 +1 @@
+escape
`;
    expect(await workspace.applyPatch(escaping)).toMatchObject({
      ok: false,
      error: { code: "PATCH_REJECTED" },
    });
  });

  test("does not partially apply a multi-file patch", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    const partiallyInvalid = `${CHANGE_ALPHA_TO_BETA}diff --git a/delete.txt b/delete.txt
--- a/delete.txt
+++ b/delete.txt
@@ -1 +1 @@
-wrong context
+replacement
`;

    expect(await workspace.applyPatch(partiallyInvalid)).toMatchObject({
      ok: false,
      error: { code: "PATCH_REJECTED" },
    });
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("alpha\n");
  });

  test("supports new and deleted files", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    const patch = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+created
diff --git a/delete.txt b/delete.txt
deleted file mode 100644
--- a/delete.txt
+++ /dev/null
@@ -1 +0,0 @@
-remove me
`;

    const result = await workspace.applyPatch(patch);
    expect(result.ok && result.value.changedFiles).toEqual(["delete.txt", "new.txt"]);
    expect(await readFile(join(workspace.workspacePath, "new.txt"), "utf8")).toBe("created\n");
    expect(await Bun.file(join(workspace.workspacePath, "delete.txt")).exists()).toBeFalse();
  });
});

describe("IsolatedWorkspace file replacement", () => {
  test("replaces a unique text snippet only inside the isolated workspace", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);

    const result = await workspace.replaceText("a.txt", "alpha", "beta");

    expect(result).toEqual({ ok: true, value: { changedFiles: ["a.txt"] } });
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("beta\n");
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("alpha\n");
  });

  test("rejects missing and ambiguous text replacements", async () => {
    const source = await sourceRepository();
    await writeFile(join(source, "a.txt"), "alpha\nalpha\n");
    const workspace = await createWorkspace(source);

    expect(await workspace.replaceText("a.txt", "missing", "beta")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
    expect(await workspace.replaceText("a.txt", "alpha", "beta")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
  });

  test("replaces text files only inside the isolated workspace", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);

    const result = await workspace.replaceFile("a.txt", "beta\n");

    expect(result).toEqual({ ok: true, value: { changedFiles: ["a.txt"] } });
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("beta\n");
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("alpha\n");
  });

  test("rejects unsafe or meaningless file replacements", async () => {
    const source = await sourceRepository();
    await writeFile(join(source, "binary.dat"), Buffer.from([1, 0, 2]));
    git(source, ["add", "binary.dat"]);
    const workspace = await createWorkspace(source);

    expect(await workspace.replaceFile("../outside.txt", "escape\n")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
    expect(await workspace.replaceFile("a.txt", "alpha\n")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
    expect(await workspace.replaceFile("a.txt", "binary\0text")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
    expect(await workspace.replaceFile("binary.dat", "text now\n")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
  });
});

describe("IsolatedWorkspace checkpoints and export", () => {
  test("restores agent changes without losing the input snapshot", async () => {
    const source = await sourceRepository();
    await writeFile(join(source, "a.txt"), "input dirty state\n");
    const workspace = await createWorkspace(source);
    const firstPatch = CHANGE_ALPHA_TO_BETA.replace("-alpha", "-input dirty state");
    expect((await workspace.applyPatch(firstPatch)).ok).toBeTrue();
    const checkpoint = await workspace.createCheckpoint("first hypothesis");
    if (!checkpoint.ok) throw new Error(checkpoint.error.message);

    await writeFile(join(workspace.workspacePath, "a.txt"), "later attempt\n");
    await writeFile(join(workspace.workspacePath, "extra.txt"), "later file\n");
    const restored = await workspace.restoreCheckpoint(checkpoint.value);

    expect(restored).toEqual({ ok: true, value: { changedFiles: ["a.txt"] } });
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("beta\n");
    expect(await Bun.file(join(workspace.workspacePath, "extra.txt")).exists()).toBeFalse();
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("input dirty state\n");
  });

  test("exports a patch against the exact input baseline and reapplies it", async () => {
    const source = await sourceRepository();
    await writeFile(join(source, "a.txt"), "input dirty state\n");
    const workspace = await createWorkspace(source);
    const patch = CHANGE_ALPHA_TO_BETA.replace("-alpha", "-input dirty state");
    expect((await workspace.applyPatch(patch)).ok).toBeTrue();

    const exported = await workspace.exportPatch();
    if (!exported.ok) throw new Error(exported.error.message);
    expect(exported.value.changedFiles).toEqual(["a.txt"]);
    expect(await readFile(exported.value.patchPath, "utf8")).not.toContain("-alpha");

    const verification = join(await temporaryDirectory("dinner-verify-parent-"), "repo");
    git(workspace.workspacePath, ["clone", "--quiet", workspace.gitDir, verification]);
    git(verification, ["checkout", "--quiet", "--detach", workspace.baselineRevision]);
    const exportedPatch = await readFile(exported.value.patchPath, "utf8");
    git(verification, ["apply", "--check", "-"], exportedPatch);
    git(verification, ["apply", "-"], exportedPatch);
    expect(await readFile(join(verification, "a.txt"), "utf8")).toBe("beta\n");
  });

  test("detects checkpoint tampering", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    expect((await workspace.applyPatch(CHANGE_ALPHA_TO_BETA)).ok).toBeTrue();
    const checkpoint = await workspace.createCheckpoint("safe state");
    if (!checkpoint.ok) throw new Error(checkpoint.error.message);
    await writeFile(checkpoint.value.patchPath, "tampered");

    expect(await workspace.restoreCheckpoint(checkpoint.value)).toMatchObject({
      ok: false,
      error: { code: "CHECKPOINT_INVALID" },
    });
  });
});

describe("IsolatedWorkspace git boundary", () => {
  test("never runs git configuration planted inside the workspace", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    const marker = join(await temporaryDirectory("dinner-marker-"), "host-command-ran");
    const plantedConfigPath = join(workspace.workspacePath, ".git", "config");
    await mkdir(join(workspace.workspacePath, ".git"), { recursive: true });
    const existingConfig = existsSync(plantedConfigPath) ? await readFile(plantedConfigPath, "utf8") : "";
    await writeFile(plantedConfigPath, `${existingConfig}[core]\n\tfsmonitor = "touch ${marker}; false"\n`);

    expect((await workspace.inspectChanges()).ok).toBeTrue();
    expect((await workspace.exportPatch()).ok).toBeTrue();
    expect(existsSync(marker)).toBeFalse();
  });

  test("keeps git metadata outside the workspace and out of the patch", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    expect(existsSync(join(workspace.workspacePath, ".git"))).toBeFalse();
    await mkdir(join(workspace.workspacePath, ".git"), { recursive: true });
    await writeFile(join(workspace.workspacePath, ".git", "planted"), "x\n");
    const state = await workspace.inspectChanges();
    if (!state.ok) throw new Error(state.error.message);
    expect(state.value.changedFiles).toEqual([]);
  });

  test("rejects edits to git metadata paths", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    for (const path of [".git/config", ".GIT/config", "nested/.git/hooks/pre-commit", ".Git"]) {
      expect(await workspace.replaceFile(path, "[core]\n")).toMatchObject({
        ok: false,
        error: { code: "REPLACEMENT_REJECTED" },
      });
    }
    expect(await workspace.replaceText(".git/config", "[core]", "[x]")).toMatchObject({
      ok: false,
      error: { code: "REPLACEMENT_REJECTED" },
    });
  });
});

describe("IsolatedWorkspace generated files", () => {
  test("ignores common build and test artifacts in the state and the exported patch", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    await mkdir(join(workspace.workspacePath, "__pycache__"), { recursive: true });
    await writeFile(join(workspace.workspacePath, "__pycache__", "a.cpython-312.pyc"), "bytecode");
    await mkdir(join(workspace.workspacePath, "node_modules", "left-pad"), { recursive: true });
    await writeFile(join(workspace.workspacePath, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
    await mkdir(join(workspace.workspacePath, ".pytest_cache"), { recursive: true });
    await writeFile(join(workspace.workspacePath, ".pytest_cache", "README.md"), "cache\n");
    await writeFile(join(workspace.workspacePath, "real-change.txt"), "kept\n");

    const state = await workspace.inspectChanges();
    if (!state.ok) throw new Error(state.error.message);
    expect(state.value.changedFiles).toEqual(["real-change.txt"]);
    const exported = await workspace.exportPatch();
    if (!exported.ok) throw new Error(exported.error.message);
    expect(await readFile(exported.value.patchPath, "utf8")).not.toContain("__pycache__");
  });
});

describe("IsolatedWorkspace fingerprint", () => {
  test("is content-addressed: an edit changes it and reverting the edit restores it", async () => {
    const source = await sourceRepository();
    const workspace = await createWorkspace(source);
    const fingerprintOf = async () => {
      const state = await workspace.inspectChanges();
      if (!state.ok) throw new Error(state.error.message);
      return state.value.fingerprint;
    };
    const baseline = await fingerprintOf();
    expect(await fingerprintOf()).toBe(baseline);
    await writeFile(join(workspace.workspacePath, "a.txt"), "edited\n");
    const edited = await fingerprintOf();
    expect(edited).not.toBe(baseline);
    await writeFile(join(workspace.workspacePath, "a.txt"), "alpha\n");
    expect(await fingerprintOf()).toBe(baseline);
  });
});

describe("IsolatedWorkspace submodules", () => {
  test("snapshots a repository that contains a submodule", async () => {
    const library = await sourceRepository();
    const source = await sourceRepository();
    git(source, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "lib"]);
    git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "add submodule"]);

    const workspace = await createWorkspace(source);
    const state = await workspace.inspectChanges();
    if (!state.ok) throw new Error(state.error.message);
    expect(state.value.changedFiles).toEqual([]);
    expect(await readFile(join(workspace.workspacePath, "a.txt"), "utf8")).toBe("alpha\n");
  });
});
