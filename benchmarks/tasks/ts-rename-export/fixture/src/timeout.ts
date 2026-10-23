import { parseDurration } from "./duration";

export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, duration: string): Promise<T> {
  const ms = parseDurration(duration);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
