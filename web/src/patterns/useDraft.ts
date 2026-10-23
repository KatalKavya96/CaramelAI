import { useState } from "react";

const memoryDrafts = new Map<string, string>();

/** Visit-local drafts are scoped by origin and account; credentials never belong here. */
export function useDraft(key: string): [string, (value: string) => void] {
  const storageKey = `caramel-draft:${key}`;
  const [value, setValue] = useState(() => {
    try { return sessionStorage.getItem(storageKey) ?? ""; } catch { return memoryDrafts.get(storageKey) ?? ""; }
  });
  return [value, (next) => {
    setValue(next);
    if (next === "") memoryDrafts.delete(storageKey);
    else memoryDrafts.set(storageKey, next);
    try {
      if (next === "") sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, next);
    } catch { /* Keep the editable draft when storage is unavailable. */ }
  }];
}
