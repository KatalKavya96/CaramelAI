import type { FileReadResult, RepositoryToolResult } from "../tools";

interface Entry {
  workspaceFingerprint: string;
  result: RepositoryToolResult<FileReadResult>;
}

export class RepositoryReadCache {
  private readonly entries = new Map<string, Entry>();

  get(path: string, startLine: number | undefined, endLine: number | undefined, workspaceFingerprint: string): RepositoryToolResult<FileReadResult> | undefined {
    const entry = this.entries.get(this.key(path, startLine, endLine));
    return entry?.workspaceFingerprint === workspaceFingerprint ? structuredClone(entry.result) : undefined;
  }

  set(path: string, startLine: number | undefined, endLine: number | undefined, workspaceFingerprint: string, result: RepositoryToolResult<FileReadResult>): void {
    this.entries.set(this.key(path, startLine, endLine), {
      workspaceFingerprint,
      result: structuredClone(result),
    });
  }

  private key(path: string, startLine: number | undefined, endLine: number | undefined): string {
    return `${path}\0${startLine ?? ""}\0${endLine ?? ""}`;
  }
}
