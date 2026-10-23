const PERCENT_OFF: Record<string, number> = {
  SAVE10: 10,
  STAFF25: 25,
};

export function isDiscountCode(code: string): boolean {
  return code in PERCENT_OFF;
}

/** Discount in cents. Rounded down to the cent, in the shop's favour. */
export function discountFor(code: string, subtotalCents: number): number {
  const percent = PERCENT_OFF[code];
  if (percent === undefined) throw new Error(`Unknown discount code: ${code}`);
  return Math.floor((subtotalCents * percent) / 100);
}
