import { parseDurration } from "./duration";

export async function retry<T>(fn: () => Promise<T>, options: { attempts: number; delay: string }): Promise<T> {
  const delayMs = parseDurration(options.delay);
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
