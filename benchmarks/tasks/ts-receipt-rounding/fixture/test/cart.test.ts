import { expect, test } from "bun:test";
import { totals } from "../src/cart";

test("adds lines, applies 8% tax", () => {
  const result = totals([{ sku: "ESP", name: "Espresso", price: 3, qty: 2 }, { sku: "CRO", name: "Croissant", price: 2.5, qty: 1 }]);
  expect(result.subtotal).toBe(850);
  expect(result.tax).toBe(68);
  expect(result.total).toBe(918);
});

test("SAVE10 takes 10% off before tax", () => {
  const result = totals([{ sku: "CAK", name: "Cake", price: 20, qty: 1 }], "SAVE10");
  expect(result.discount).toBe(200);
  expect(result.tax).toBe(144);
  expect(result.total).toBe(1944);
});
