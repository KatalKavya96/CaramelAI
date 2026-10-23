import type { Totals } from "./cart";
import { formatCents } from "./money";

export function renderReceipt(totals: Totals, code?: string): string {
  const rows = totals.lines.map((line) => `${line.qty} x ${line.name}  ${formatCents(line.cents)}`);
  rows.push(`Subtotal: ${formatCents(totals.subtotal)}`);
  if (code !== undefined) rows.push(`Discount (${code}): -${formatCents(totals.discount)}`);
  rows.push(`Tax: ${formatCents(totals.tax)}`);
  rows.push(`Total: ${formatCents(totals.total)}`);
  return rows.join("\n");
}
