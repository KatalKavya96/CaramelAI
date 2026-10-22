export type DiffLineKind = "add" | "del" | "context" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffFile {
  path: string;
  /** "added" when the old side is /dev/null, "deleted" when the new side is. */
  change: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

/** Parses a unified (git) diff into files and numbered lines. Unknown lines are kept as meta. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldPath = "";

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      current = { path: match?.[2] ?? raw.slice(11), change: "modified", additions: 0, deletions: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (raw.startsWith("--- ")) {
      oldPath = raw.slice(4).replace(/^a\//, "");
      if (current === null) {
        current = { path: oldPath, change: "modified", additions: 0, deletions: 0, lines: [] };
        files.push(current);
      }
      if (oldPath === "/dev/null") current.change = "added";
      continue;
    }
    if (raw.startsWith("+++ ") && current !== null) {
      const newPath = raw.slice(4).replace(/^b\//, "");
      if (newPath === "/dev/null") current.change = "deleted";
      else current.path = newPath;
      if (current.change === "modified" && oldPath !== "" && oldPath !== "/dev/null" && oldPath !== newPath) current.change = "renamed";
      continue;
    }
    if (current === null) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      current.lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      current.additions += 1;
      current.lines.push({ kind: "add", text: raw.slice(1), newNumber: newLine++ });
    } else if (raw.startsWith("-")) {
      current.deletions += 1;
      current.lines.push({ kind: "del", text: raw.slice(1), oldNumber: oldLine++ });
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", text: raw.slice(1), oldNumber: oldLine++, newNumber: newLine++ });
    } else if (raw.startsWith("\\") || raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") || raw.startsWith("similarity") || raw.startsWith("rename ")) {
      current.lines.push({ kind: "meta", text: raw });
    }
  }
  return files;
}
