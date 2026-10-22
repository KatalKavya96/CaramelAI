/**
 * Compiles the Bun backend into one executable where Tauri expects a sidecar:
 * src-tauri/binaries/caramel-backend-<target triple>[.exe]. Tauri picks the file whose
 * suffix matches the platform it is building for, so the triple must come from rustc.
 */
import { join, resolve } from "node:path";

const rustc = Bun.spawnSync(["rustc", "-vV"], { stdout: "pipe" });
const triple = /^host: (\S+)$/m.exec(rustc.stdout.toString())?.[1];
if (rustc.exitCode !== 0 || triple === undefined) throw new Error("rustc -vV did not report a host triple. Is Rust installed?");

const root = resolve(import.meta.dir, "../..");
const extension = triple.includes("windows") ? ".exe" : "";
const outfile = join(import.meta.dir, "../src-tauri/binaries", `caramel-backend-${triple}${extension}`);
const build = Bun.spawnSync(
  ["bun", "build", "--compile", "--minify", join(root, "src/server/local-main.ts"), "--outfile", outfile],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
console.log(`Backend compiled to ${outfile}`);
