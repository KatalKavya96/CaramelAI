// Prints receipts the way a café owner would, from cart files, and checks what lands on paper.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.env.DINNER_WORKSPACE!;
const scratch = mkdtempSync(join(tmpdir(), "tillroll-"));

function receipt(items: unknown[], ...args: string[]): { out: string; code: number } {
  const file = join(scratch, `${crypto.randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(items));
  const run = Bun.spawnSync(["bun", "run", "src/cli.ts", file, ...args], { cwd: workspace });
  return { out: run.stdout.toString(), code: run.exitCode };
}

const reporterCart = [
  { sku: "LAT", name: "Oat latte", price: 4.35, qty: 1 },
  { sku: "MUF", name: "Blueberry muffin", price: 2.95, qty: 2 },
];

test("the cart from the issue totals $10.25 before tax", () => {
  const { out, code } = receipt(reporterCart);
  expect(code).toBe(0);
  expect(out).toContain("1 x Oat latte  $4.35");
  expect(out).toContain("Subtotal: $10.25");
  expect(out).toContain("Tax: $0.82");
  expect(out).toContain("Total: $11.07");
});

test("prices like 19.99 and 0.29 keep every cent", () => {
  const { out } = receipt([{ sku: "BNS", name: "Beans 1kg", price: 19.99, qty: 3 }, { sku: "SUG", name: "Sugar stick", price: 0.29, qty: 1 }]);
  expect(out).toContain("3 x Beans 1kg  $59.97");
  expect(out).toContain("1 x Sugar stick  $0.29");
  expect(out).toContain("Subtotal: $60.26");
});

test("discounts still round down to the cent, as the README promises", () => {
  const save10 = receipt(reporterCart, "--code", "SAVE10").out;
  expect(save10).toContain("Discount (SAVE10): -$1.02");
  expect(save10).toContain("Total: $9.97");
  // 25% of $10.03 is $2.5075: the shop gives $2.50, not $2.51.
  const staff = receipt([{ sku: "SND", name: "Sandwich", price: 10.03, qty: 1 }], "--code", "STAFF25").out;
  expect(staff).toContain("Subtotal: $10.03");
  expect(staff).toContain("Discount (STAFF25): -$2.50");
});
