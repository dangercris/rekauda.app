/**
 * Safe JSON helpers over localStorage / sessionStorage. Storage can be missing or throw
 * (private mode, quota, disabled cookies): every call degrades to a no-op / fallback.
 */

export type StorageArea = "local" | "session";

function area(kind: StorageArea): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads and validates a JSON value. Returns null when missing, unparseable or rejected by `guard`. */
export function readJson<T>(key: string, guard: (value: unknown) => value is T, kind: StorageArea = "local"): T | null {
  const store = area(kind);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes a JSON value. Returns false when storage is unavailable or full. */
export function writeJson(key: string, value: unknown, kind: StorageArea = "local"): boolean {
  const store = area(kind);
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string, kind: StorageArea = "local"): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/** Common guards for `readJson`. */
export const isString = (value: unknown): value is string => typeof value === "string";
export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
