import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * The layering rule, enforced: a module may import only from its own layer or the ones below.
 * Without this test the folders would only be a convention, and convention is what erodes first.
 */
const SRC = resolve(__dirname, "../src");
const RANK: Record<string, number> = { tokens: 0, lib: 0, ui: 1, patterns: 2, domain: 3, data: 4, screens: 5, app: 5 };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const layerOf = (path: string) => relative(SRC, path).split(sep)[0] ?? "";

describe("layer boundaries", () => {
  const sources = files(SRC);

  it("imports only point down", () => {
    const violations: string[] = [];
    for (const file of sources) {
      const from = layerOf(file);
      if (!(from in RANK)) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const target = layerOf(resolve(file, "..", match[1] as string));
        if (target in RANK && (RANK[target] as number) > (RANK[from] as number)) violations.push(`${relative(SRC, file)} -> ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("only data/ talks to the server, and only lib/contract reaches into the core", () => {
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const rel = relative(SRC, file);
      if (/\bfetch\(|new EventSource\(/.test(text) && layerOf(file) !== "data") violations.push(`${rel} uses the network`);
      if (/from\s+"@core\//.test(text) && rel !== join("lib", "contract.ts")) violations.push(`${rel} imports @core directly`);
      if (/\bBun\./.test(text)) violations.push(`${rel} uses Bun APIs`);
      if (/#[0-9a-fA-F]{6}\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, "")) && file.endsWith(".tsx")) violations.push(`${rel} hard-codes a colour`);
    }
    expect(violations).toEqual([]);
  });

  it("the core modules the browser bundles import nothing at runtime", () => {
    const runtime = readFileSync(resolve(SRC, "../../src/agent/run-state.ts"), "utf8").match(/^import (?!type).*$/gm) ?? [];
    expect(runtime).toEqual([]);
  });
});
