export interface SlugOptions {
  /** Put between words. Default "-". */
  separator?: string;
  /** Longest slug allowed. The slug is cut after the last whole word that fits. */
  maxLength?: number;
}

export function slugify(input: string, options: SlugOptions = {}): string {
  const separator = options.separator ?? "-";
  const words = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  if (options.maxLength === undefined) return words.join(separator);

  let slug = "";
  for (const word of words) {
    const next = slug === "" ? word : `${slug}${separator}${word}`;
    if (next.length > options.maxLength) break;
    slug = next;
  }
  return slug;
}
