import { useEffect, useRef } from "react";
import { readJson, removeItem, writeJson } from "../../../lib/storage";
import { draftKey, isPayDraft, toDraft, type PayDraft, type PayState } from "./payFlow";

export const DRAFT_DEBOUNCE_MS = 250;

/** Draft saved for a collection in this tab (parents switch to the Deuna app and come back). */
export function loadDraft(slug: string): PayDraft | null {
  return readJson(draftKey(slug), isPayDraft, "session");
}

export function clearDraft(slug: string): void {
  removeItem(draftKey(slug), "session");
}

/**
 * Persists the in-progress form (never the file) to sessionStorage with a debounce, and flushes it
 * right away when the page is hidden (switching to the bank app). Nothing is saved on the success
 * screen: the draft was cleared when the payment was registered.
 */
export function usePayDraft(slug: string, state: PayState, enabled: boolean): void {
  const pending = useRef<PayDraft | null>(null);
  const { step, count, students, fields } = state;

  useEffect(() => {
    if (!enabled || step === 3) {
      pending.current = null;
      return undefined;
    }
    const draft = toDraft(state);
    pending.current = draft;
    const timer = setTimeout(() => {
      writeJson(draftKey(slug), draft, "session");
      pending.current = null;
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only the persisted parts of the state trigger a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, enabled, step, count, students, fields]);

  useEffect(() => {
    if (!enabled) return undefined;
    const flush = () => {
      if (!pending.current) return;
      writeJson(draftKey(slug), pending.current, "session");
      pending.current = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [slug, enabled]);
}
