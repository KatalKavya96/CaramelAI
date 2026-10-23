import { parseDurration } from "./duration";

const [text] = process.argv.slice(2);
if (text === undefined) {
  console.error("Usage: bun run src/cli.ts <duration>");
  process.exit(1);
}
try {
  console.log(parseDurration(text));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
