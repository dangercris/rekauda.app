/**
 * Shared cache for GET /api/lookup. The lookup endpoint is rate limited per IP (a whole school network can
 * share one IP), so statuses are cached for 60 s and background refreshes stop for a minute after a 429.
 */
import type { LookupResponse } from "../../../shared/api";
import { isApiRequestError, lookupPayment, normalizeTrackingCode, type RequestOptions } from "../../lib/publicApi";

export const LOOKUP_FRESH_MS = 60_000;
export const RATE_LIMIT_PAUSE_MS = 60_000;

interface Entry {
  data: LookupResponse;
  at: number;
}

const cache = new Map<string, Entry>();
let blockedUntil = 0;

/** Last known result for a code, fresh or not (for an instant first paint). */
export function peekLookup(code: string): LookupResponse | null {
  return cache.get(normalizeTrackingCode(code))?.data ?? null;
}

export function isFresh(code: string, now: number = Date.now()): boolean {
  const entry = cache.get(normalizeTrackingCode(code));
  return entry !== undefined && now - entry.at < LOOKUP_FRESH_MS;
}

/** True while background refreshes are paused after a 429. */
export function isRateLimited(now: number = Date.now()): boolean {
  return now < blockedUntil;
}

/** Fetches a code and caches the result. A 429 pauses background refreshes; the error is rethrown. */
export async function fetchLookup(code: string, options?: RequestOptions): Promise<LookupResponse> {
  const key = normalizeTrackingCode(code);
  try {
    const data = await lookupPayment(key, options);
    cache.set(key, { data, at: Date.now() });
    return data;
  } catch (error) {
    if (isApiRequestError(error) && error.status === 429) blockedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
    throw error;
  }
}

/** Test helper. */
export function resetLookupStore(): void {
  cache.clear();
  blockedUntil = 0;
}
