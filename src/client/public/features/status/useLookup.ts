import { useCallback, useEffect, useRef, useState } from "react";
import type { LookupResponse } from "../../../../shared/api";
import { errorMessage, isApiRequestError } from "../../../lib/publicApi";
import { track } from "../../lib/analytics";
import { fetchLookup, isFresh, isRateLimited, peekLookup } from "../../lib/lookupStore";

export type LookupState =
  | { status: "idle" }
  | { status: "loading"; code: string }
  | { status: "success"; code: string; data: LookupResponse }
  | { status: "error"; code: string; message: string };

/** One explicit lookup at a time (newer ones abort older ones); aborted on unmount. */
export function useLookup(): { state: LookupState; lookup: (code: string) => void; reset: () => void } {
  const [state, setState] = useState<LookupState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const lookup = useCallback((code: string) => {
    controller.current?.abort();
    const cached = peekLookup(code);
    if (cached && isFresh(code)) {
      setState({ status: "success", code, data: cached });
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setState({ status: "loading", code });
    fetchLookup(code, { signal: current.signal }).then(
      (data) => {
        if (current.signal.aborted) return;
        track("status_lookup", { result: "found" });
        setState({ status: "success", code, data });
      },
      (error: unknown) => {
        if (current.signal.aborted) return;
        track("status_lookup", { result: isApiRequestError(error) && error.status === 404 ? "not_found" : "error" });
        const message = isApiRequestError(error) && error.status === 404 ? "No encontramos un pago con ese código. Revísalo e intenta de nuevo." : errorMessage(error);
        setState({ status: "error", code, message });
      },
    );
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, lookup, reset };
}

export type SavedStatus =
  | { status: "loading" }
  | { status: "ok"; data: LookupResponse }
  | { status: "error"; message: string };

/**
 * Statuses of the codes saved on this phone. Refreshes only stale entries (60 s cache), one at a time,
 * when `active` becomes true, and stops at the first 429 (the limit is shared per IP).
 */
export function useSavedStatuses(codes: readonly string[], active: boolean): Record<string, SavedStatus> {
  const [statuses, setStatuses] = useState<Record<string, SavedStatus>>(() => initial(codes));
  const codesKey = codes.join(",");

  useEffect(() => {
    setStatuses((prev) => {
      const next: Record<string, SavedStatus> = {};
      for (const code of codes) {
        const cached = peekLookup(code);
        next[code] = cached ? { status: "ok", data: cached } : (prev[code] ?? { status: "loading" });
      }
      return next;
    });
    if (!active) return undefined;
    const controller = new AbortController();
    void (async () => {
      for (const code of codes) {
        if (controller.signal.aborted) return;
        if (isRateLimited()) {
          setStatuses((prev) => markPending(prev, codes, "No se pudo consultar"));
          break;
        }
        if (isFresh(code)) continue;
        try {
          const data = await fetchLookup(code, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setStatuses((prev) => ({ ...prev, [code]: { status: "ok", data } }));
        } catch (error) {
          if (controller.signal.aborted) return;
          const notFound = isApiRequestError(error) && error.status === 404;
          setStatuses((prev) => {
            const existing = prev[code];
            // Keep a previous result over a transient failure.
            if (!notFound && existing?.status === "ok") return prev;
            return { ...prev, [code]: { status: "error", message: notFound ? "No encontrado" : "No se pudo consultar" } };
          });
          if (isApiRequestError(error) && error.status === 429) {
            setStatuses((prev) => markPending(prev, codes, "No se pudo consultar"));
            break;
          }
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- codesKey stands for codes.
  }, [codesKey, active]);

  return statuses;
}

function initial(codes: readonly string[]): Record<string, SavedStatus> {
  const out: Record<string, SavedStatus> = {};
  for (const code of codes) {
    const cached = peekLookup(code);
    out[code] = cached ? { status: "ok", data: cached } : { status: "loading" };
  }
  return out;
}

/** After a 429, rows still waiting stop showing a skeleton. */
function markPending(prev: Record<string, SavedStatus>, codes: readonly string[], message: string): Record<string, SavedStatus> {
  const next = { ...prev };
  for (const code of codes) if (next[code]?.status === "loading") next[code] = { status: "error", message };
  return next;
}
