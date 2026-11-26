import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

function subscribeMedia(query: string) {
  return (onChange: () => void): (() => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

/** Live `matchMedia(query).matches` (false on the server and when matchMedia is missing). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(() => subscribeMedia(query), [query]);
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

export const FINE_POINTER = "(hover: hover) and (pointer: fine)";
export const COARSE_POINTER = "(pointer: coarse)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const TYPING_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]), select, textarea';

/**
 * True while a text field has focus on a touch device (the on-screen keyboard is up), so the bottom
 * tab bar can step aside and give the form room.
 */
export function useKeyboardOpen(): boolean {
  const coarse = useMediaQuery(COARSE_POINTER);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!coarse) {
      setTyping(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onIn = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(TYPING_SELECTOR)) {
        if (timer) clearTimeout(timer);
        setTyping(true);
      }
    };
    const onOut = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setTyping(false), 120);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [coarse]);
  return typing;
}

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

/** Scrolls to the top without smooth scrolling (step and tab changes). */
export function scrollToTop(): void {
  if (typeof window !== "undefined") window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}
