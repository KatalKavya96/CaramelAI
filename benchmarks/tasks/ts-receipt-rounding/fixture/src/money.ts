/** Converts a price in dollars, as written in a cart file, to integer cents. */
export function toCents(amount: number): number {
  return Math.floor(amount * 100);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
