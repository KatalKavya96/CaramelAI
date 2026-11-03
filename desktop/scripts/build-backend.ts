/**
 * Compiles the Bun backend into one executable where Tauri expects a sidecar:
 * src-tauri/binaries/caramel-backend-<target triple>[.exe]. Tauri picks the file whose
 * suffix matches the platform it is building for, so the triple must come from rustc.
 *
 * `--universal` (macOS only) builds for Apple Silicon and Intel and joins them with lipo into
 * caramel-backend-universal-apple-darwin, which `tauri build --target universal-apple-darwin`
 * looks for. Without it, a release built on an M-series Mac would not start on an Intel one.
 */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const binaries = join(import.meta.dir, "../src-tauri/binaries");

function compile(outfile: string, target?: string): void {
  const build = Bun.spawnSync(
    ["bun", "build", "--compile", "--minify", ...(target === undefined ? [] : [`--target=${target}`]),
      join(root, "src/server/local-main.ts"), "--outfile", outfile],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
}

if (process.argv.includes("--universal")) {
  if (process.platform !== "darwin") throw new Error("--universal builds a macOS binary and needs lipo, so run it on a Mac.");
  const thin = [["bun-darwin-arm64", "aarch64-apple-darwin"], ["bun-darwin-x64", "x86_64-apple-darwin"]] as const;
  for (const [target, triple] of thin) compile(join(binaries, `caramel-backend-${triple}`), target);
  const outfile = join(binaries, "caramel-backend-universal-apple-darwin");
  const lipo = Bun.spawnSync(
    ["lipo", "-create", ...thin.map(([, triple]) => join(binaries, `caramel-backend-${triple}`)), "-output", outfile],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (lipo.exitCode !== 0) process.exit(lipo.exitCode ?? 1);
  console.log(`Backend compiled to ${outfile}`);
} else {
  const rustc = Bun.spawnSync(["rustc", "-vV"], { stdout: "pipe" });
  const triple = /^host: (\S+)$/m.exec(rustc.stdout.toString())?.[1];
  if (rustc.exitCode !== 0 || triple === undefined) throw new Error("rustc -vV did not report a host triple. Is Rust installed?");
  const outfile = join(binaries, `caramel-backend-${triple}${triple.includes("windows") ? ".exe" : ""}`);
  compile(outfile);
  console.log(`Backend compiled to ${outfile}`);
}
