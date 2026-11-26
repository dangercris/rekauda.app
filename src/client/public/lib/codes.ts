/**
 * Tracking codes registered from this phone (localStorage), newest first. The key was renamed when the
 * site grew from one collection to many; the legacy key is still read so old codes are not lost.
 */
import { readJson, writeJson } from "../../lib/storage";

export const CODES_KEY = "rec-1ba-codes";
export const LEGACY_CODES_KEY = "musical-1ba-codes";
export const MAX_SAVED_CODES = 12;

const CODE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

function clean(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const code = raw.trim().toUpperCase();
    if (CODE_RE.test(code) && !out.includes(code)) out.push(code);
    if (out.length >= MAX_SAVED_CODES) break;
  }
  return out;
}

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

function readList(key: string): string[] | null {
  const list = readJson(key, isUnknownArray);
  if (!list) return null;
  return clean(list.filter((item): item is string => typeof item === "string"));
}

export function readCodes(): string[] {
  return readList(CODES_KEY) ?? readList(LEGACY_CODES_KEY) ?? [];
}

/** Adds a code at the top (deduplicated, capped). Returns the new list. */
export function saveCode(code: string): string[] {
  const next = clean([code, ...readCodes()]);
  writeJson(CODES_KEY, next);
  return next;
}
