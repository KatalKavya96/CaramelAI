import type { RepositoryToolErrorCode, RepositoryToolResult } from "./types";

/** Thrown inside a tool and turned into a RepositoryToolResult failure at its boundary. */
export class RepositoryToolException extends Error {
  constructor(
    readonly code: RepositoryToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryToolException";
  }
}

export function success<T>(value: T): RepositoryToolResult<T> {
  return { ok: true, value };
}

export function failure(error: unknown): RepositoryToolResult<never> {
  if (error instanceof RepositoryToolException) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: "IO_ERROR", message: detail } };
}

export function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RepositoryToolException("INVALID_ARGUMENT", `${name} must be a positive integer.`);
  }
  return value;
}
