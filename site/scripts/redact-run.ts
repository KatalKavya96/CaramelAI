/**
 * Turns a real run's output folder into a JSON file the landing page can replay.
 *
 *   bun scripts/redact-run.ts <run-output-dir> --id verified --label Verified \
 *     --repo https://github.com/owner/repo --model deepseek-flash [--secret myname] > src/replay/runs/verified.json
 *
 * Reads events.jsonl and result.json from the folder and the patch result.json points at.
 * Always read the output before committing it: the patterns catch common secrets, not every secret.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunResult } from "@core/agent/types";
import { redactRun } from "./redact";

function arg(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined && required) {
    console.error(`Missing --${name}. See the comment at the top of scripts/redact-run.ts.`);
    process.exit(1);
  }
  return value;
}

function all(name: string): string[] {
  return process.argv.flatMap((value, index) => (value === `--${name}` && process.argv[index + 1] !== undefined ? [process.argv[index + 1] as string] : []));
}

const dir = process.argv[2];
if (dir === undefined || dir.startsWith("--")) {
  console.error("Usage: bun scripts/redact-run.ts <run-output-dir> --id <id> --label <tab label> --repo <public url> --model <model>");
  process.exit(1);
}

const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as AgentRunResult;
const eventsPath = existsSync(join(dir, "events.jsonl")) ? join(dir, "events.jsonl") : result.eventsPath;
const patchPath = existsSync(result.patchPath)
  ? result.patchPath
  : readdirSync(dir).filter((name) => name.endsWith(".patch") || name.endsWith(".diff")).map((name) => join(dir, name))[0];

const run = redactRun(
  {
    eventsJsonl: readFileSync(eventsPath, "utf8"),
    result,
    patch: patchPath === undefined ? "" : readFileSync(patchPath, "utf8"),
  },
  {
    id: arg("id") as string,
    label: arg("label") as string,
    repoUrl: arg("repo") as string,
    model: arg("model") as string,
    extraSecrets: all("secret"),
  },
);

process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
