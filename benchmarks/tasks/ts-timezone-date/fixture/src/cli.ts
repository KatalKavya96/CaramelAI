import { readFileSync } from "node:fs";
import { reminderLine, type Task } from "./reminder";

const [file] = process.argv.slice(2);
if (file === undefined) {
  console.error("Usage: bun run src/cli.ts <tasks.json>");
  process.exit(1);
}
for (const task of JSON.parse(readFileSync(file, "utf8")) as Task[]) console.log(reminderLine(task));
