import { open } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

export function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function appendWithinLimit(current: string, addition: string, limit: number): [string, boolean] {
  const available = limit - byteLength(current);
  if (available <= 0) return [current, true];
  if (byteLength(addition) <= available) return [current + addition, false];
  return [current + Buffer.from(addition).subarray(0, available).toString("utf8"), true];
}

export async function isBinaryFile(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
