// Checks the rename the way the two kinds of downstream user would meet it, and the way a reviewer reads the diff.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.env.DINNER_WORKSPACE!;
const api = await import(`${workspace}/src/index.ts`);

test("new code can import parseDuration from the package entry point", () => {
  expect(typeof api.parseDuration).toBe("function");
  expect(api.parseDuration("1h30m")).toBe(5_400_000);
  expect(api.parseDuration("1.5s")).toBe(1500);
  expect(() => api.parseDuration("soon")).toThrow(RangeError);
});

test("code written against 1.6 keeps working through the old name", () => {
  expect(typeof api.parseDurration).toBe("function");
  expect(api.parseDurration("250ms")).toBe(250);
  expect(api.parseDurration("2m")).toBe(api.parseDuration("2m"));
});

test("the CLI still works", () => {
  const run = Bun.spawnSync(["bun", "run", "src/cli.ts", "1h30m"], { cwd: workspace });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString().trim()).toBe("5400000");
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
}

test("inside src/, the old name appears only as the deprecated alias (or a re-export of it)", () => {
  let deprecatedAliases = 0;
  for (const file of sourceFiles(join(workspace, "src"))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.includes("parseDurration")) return;
      const deprecated = lines.slice(Math.max(0, index - 6), index + 1).join("\n").includes("@deprecated");
      const reExport = /^\s*export\s*\{[^}]*\}\s*from\s/.test(line);
      if (deprecated) deprecatedAliases += 1;
      // A caller still using the old name inside the library fails here.
      expect({ file, line, allowed: deprecated || reExport }).toEqual({ file, line, allowed: true });
    });
  }
  expect(deprecatedAliases).toBeGreaterThan(0);
});

test("the README documents parseDuration and only mentions the old name as deprecated", () => {
  const readme = readFileSync(join(workspace, "README.md"), "utf8");
  expect(readme).toContain("parseDuration(");
  for (const line of readme.split("\n").filter((line) => line.includes("parseDurration"))) {
    expect(line.toLowerCase()).toContain("deprecat");
  }
});
