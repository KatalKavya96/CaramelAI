import { expect, test } from "bun:test";
import { totals } from "../src/cart";
import { renderReceipt } from "../src/receipt";

test("prints one row per line and the totals", () => {
  const receipt = renderReceipt(totals([{ sku: "ESP", name: "Espresso", price: 3, qty: 2 }]));
  expect(receipt).toBe(["2 x Espresso  $6.00", "Subtotal: $6.00", "Tax: $0.48", "Total: $6.48"].join("\n"));
});
