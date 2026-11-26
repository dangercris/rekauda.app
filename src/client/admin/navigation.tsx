/**
 * Hash navigation with an unsaved-changes guard.
 *
 * Every way of leaving a screen ends up as a route change (tab clicks and links call the router's
 * `navigate`, the back button fires popstate/hashchange), so the guard works on the route itself:
 * while a screen is guarded, any other hash keeps rendering the guarded screen, the URL is put back,
 * and the attempted destination waits in `pending` until the person discards or keeps editing.
 * No window.confirm: the guarded screen shows an inline notice.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { navigate, useRoute } from "../lib/router";
import { parseHash, type AdminRoute } from "./routes";

export interface NavigationValue {
  /** The route to render (the guarded one while leaving is blocked). */
  route: AdminRoute | null;
  /** Hash being rendered, without "#". */
  hash: string;
  /** Destination the person tried to open while the screen had unsaved changes. */
  pending: string | null;
  /** Guard the current screen. */
  block: (hash: string) => void;
  release: () => void;
  /** Drop the guard and continue to `target` (default: `pending`), e.g. discard changes or after saving. */
  leave: (target?: string) => void;
  /** Keep editing (dismiss the notice). */
  stay: () => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

const clean = (hash: string): string => (hash.startsWith("#") ? hash.slice(1) : hash);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useRoute();
  const current = clean(location.hash);
  const [guard, setGuard] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const blocked = guard !== null && current !== guard;
  const hash = blocked && guard !== null ? guard : current;

  useEffect(() => {
    if (!blocked || guard === null) return;
    setPending(current);
    navigate(`#${guard}`, { replace: true });
  }, [blocked, guard, current]);

  // Navigate only after the guard is gone from state, so the destination is not blocked again.
  useEffect(() => {
    if (guard !== null || leaveTo === null) return;
    const target = leaveTo;
    setLeaveTo(null);
    navigate(target ? `#${target}` : window.location.pathname);
  }, [guard, leaveTo]);

  const block = useCallback((next: string) => setGuard(clean(next)), []);
  const release = useCallback(() => {
    setGuard(null);
    setPending(null);
  }, []);
  const leave = useCallback(
    (target?: string) => {
      const destination = target !== undefined ? clean(target) : pending;
      setPending(null);
      setGuard(null);
      if (destination !== null) setLeaveTo(destination);
    },
    [pending],
  );
  const stay = useCallback(() => setPending(null), []);

  const route = useMemo(() => parseHash(hash), [hash]);
  const value = useMemo<NavigationValue>(
    () => ({ route, hash, pending, block, release, leave, stay }),
    [route, hash, pending, block, release, leave, stay],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return value;
}

/**
 * Guards the current screen while `dirty` is true (route changes and closing the tab).
 * Returns the pending destination and the two answers for the inline notice.
 */
export function useUnsavedGuard(dirty: boolean): Pick<NavigationValue, "pending" | "leave" | "stay"> {
  const { hash, block, release, pending, leave, stay } = useNavigation();
  const [guardedHash] = useState(hash);

  useEffect(() => {
    if (dirty) block(guardedHash);
    else release();
  }, [dirty, guardedHash, block, release]);

  useEffect(() => () => release(), [release]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return { pending, leave, stay };
}
