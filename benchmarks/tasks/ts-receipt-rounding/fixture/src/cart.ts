import { discountFor } from "./discounts";
import { toCents } from "./money";

export interface LineItem {
  sku: string;
  name: string;
  /** Dollars, as written in the cart file. */
  price: number;
  qty: number;
}

export interface Totals {
  lines: { name: string; qty: number; cents: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export const TAX_RATE = 0.08;

export function totals(items: readonly LineItem[], code?: string): Totals {
  const lines = items.map((item) => ({ name: item.name, qty: item.qty, cents: toCents(item.price) * item.qty }));
  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0);
  const discount = code === undefined ? 0 : discountFor(code, subtotal);
  const tax = Math.round((subtotal - discount) * TAX_RATE);
  return { lines, subtotal, discount, tax, total: subtotal - discount + tax };
}
