import { readFileSync } from "node:fs";
import { totals, type LineItem } from "./cart";
import { isDiscountCode } from "./discounts";
import { renderReceipt } from "./receipt";

const args = process.argv.slice(2);
const codeIndex = args.indexOf("--code");
const code = codeIndex >= 0 ? args[codeIndex + 1] : undefined;
const file = args.find((arg, index) => !arg.startsWith("--") && (codeIndex < 0 || index !== codeIndex + 1));

if (file === undefined) {
  console.error("Usage: bun run src/cli.ts <cart.json> [--code CODE]");
  process.exit(1);
}
if (code !== undefined && !isDiscountCode(code)) {
  console.error(`Unknown discount code: ${code}`);
  process.exit(1);
}
const items = JSON.parse(readFileSync(file, "utf8")) as LineItem[];
console.log(renderReceipt(totals(items, code), code));
