export type WorkspaceErrorCode =
  | "INVALID_SOURCE"
  | "INVALID_OUTPUT"
  | "UNSUPPORTED_ENTRY"
  | "PATCH_REJECTED"
  | "REPLACEMENT_REJECTED"
  | "CHECKPOINT_INVALID"
  | "GIT_ERROR"
  | "IO_ERROR";

export interface WorkspaceFailure {
  ok: false;
  error: {
    code: WorkspaceErrorCode;
    message: string;
  };
}

export interface WorkspaceSuccess<T> {
  ok: true;
  value: T;
}

export type WorkspaceResult<T> = WorkspaceSuccess<T> | WorkspaceFailure;

export interface WorkspaceSnapshot {
  sourcePath: string;
  sourceRevision: string | null;
  workspacePath: string;
  gitDir: string;
  runRoot: string;
  baselineRevision: string;
}

export interface PatchApplication {
  changedFiles: string[];
}

export interface WorkspaceCheckpoint {
  id: string;
  label: string;
  patchPath: string;
  patchSha256: string;
  changedFiles: string[];
}

export interface PatchExport {
  patchPath: string;
  patchSha256: string;
  changedFiles: string[];
  bytes: number;
}

export interface WorkspaceState {
  patchSha256: string;
  changedFiles: string[];
  bytes: number;
}
