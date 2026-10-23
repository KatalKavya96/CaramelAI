// A new user copies the README's Quick start and expects exactly what the comments promise.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.env.DINNER_WORKSPACE!;
const { slugify } = await import(`${workspace}/src/index.ts`);
const readme = readFileSync(join(workspace, "README.md"), "utf8");

interface Example { call: string; promised: string }

function examples(): Example[] {
  const found: Example[] = [];
  for (const block of readme.matchAll(/```ts\n([\s\S]*?)```/g)) {
    const lines = block[1]!.split("\n").map((line) => line.trim());
    lines.forEach((line, index) => {
      const promise = lines[index + 1]?.match(/^\/\/ => (".*")$/);
      if (line.startsWith("slugify(") && promise) found.push({ call: line.replace(/;$/, ""), promised: JSON.parse(promise[1]!) });
    });
  }
  return found;
}

test("the Quick start still shows the separator and maxLength examples", () => {
  const calls = examples().map(({ call }) => call);
  expect(calls.length).toBeGreaterThanOrEqual(3);
  expect(calls.some((call) => call.includes("separator"))).toBeTrue();
  expect(calls.some((call) => call.includes("maxLength"))).toBeTrue();
});

test("every README example prints what its comment promises", () => {
  for (const { call, promised } of examples()) {
    const actual = new Function("slugify", `return ${call};`)(slugify);
    expect({ call, result: actual }).toEqual({ call, result: promised });
  }
});

test("the options table names the option the code reads", () => {
  expect(readme).toMatch(/\|\s*`separator`\s*\|/);
  expect(readme).not.toMatch(/\|\s*`sep`\s*\|/);
});

test("the code was not changed: 2.0 renamed the option on purpose", () => {
  const original = join(import.meta.dir, "original-src");
  for (const name of readdirSync(original)) {
    expect({ name, text: readFileSync(join(workspace, "src", name), "utf8") }).toEqual({ name, text: readFileSync(join(original, name), "utf8") });
  }
});
