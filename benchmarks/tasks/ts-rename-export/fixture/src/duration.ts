const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const PART = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;

/** Milliseconds for a human duration such as "2m", "1h30m", "1.5s" or "250ms". */
export function parseDurration(text: string): number {
  const trimmed = text.trim();
  let total = 0;
  let consumed = 0;
  for (const match of trimmed.matchAll(PART)) {
    if (match.index !== consumed) break;
    total += Number(match[1]) * UNIT_MS[match[2]!]!;
    consumed += match[0].length;
  }
  if (trimmed === "" || consumed !== trimmed.length) throw new RangeError(`Not a duration: "${text}"`);
  return Math.round(total);
}
