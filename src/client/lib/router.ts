/**
 * Tiny typed router: History API for pages, the hash for in-page tabs.
 *
 *   const route = useRoute();                       // { path, hash, query }
 *   const params = matchPath("/e/:slug", route.path) // { slug: string } | null
 *   navigate("/e/navidad");  navigate("#pagos", { replace: true });
 *
 * All navigation goes through `navigate` (or <Link>), plus browser back/forward (popstate/hashchange).
 */
import { useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";

export interface RouteState {
  /** Pathname without trailing slash (except "/"), e.g. "/e/navidad". */
  path: string;
  /** Hash without "#", decoded, e.g. "pagos". Empty string when none. */
  hash: string;
  /** Parsed query string. Treat as read-only. */
  query: URLSearchParams;
}

export interface NavigateOptions {
  replace?: boolean | undefined;
  /** Scroll to the top after a path change (default true; ignored for hash-only changes). */
  scroll?: boolean | undefined;
}

const listeners = new Set<() => void>();
let snapshot: RouteState | null = null;
let snapshotKey = "";

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.replace(/\/+$/, "") || "/";
  return pathname || "/";
}

function decodeHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readLocation(): RouteState {
  if (typeof window === "undefined") return { path: "/", hash: "", query: new URLSearchParams() };
  const { pathname, search, hash } = window.location;
  const key = `${pathname}${search}${hash}`;
  if (snapshot && key === snapshotKey) return snapshot;
  snapshotKey = key;
  snapshot = { path: normalizePath(pathname), hash: decodeHash(hash), query: new URLSearchParams(search) };
  return snapshot;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("popstate", emit);
    window.addEventListener("hashchange", emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("popstate", emit);
      window.removeEventListener("hashchange", emit);
    }
  };
}

/** Current route; re-renders on navigation. */
export function useRoute(): RouteState {
  return useSyncExternalStore(subscribe, readLocation, readLocation);
}

/** Read the current route outside React. */
export function getRoute(): RouteState {
  return readLocation();
}

/**
 * Navigates to a same-origin URL: "/e/navidad", "?code=ABC-123", "#pagos", or "/admin#pagos".
 * External or cross-origin URLs fall back to a full page load.
 */
export function navigate(to: string, options: NavigateOptions = {}): void {
  if (typeof window === "undefined") return;
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  const pathChanged = url.pathname !== window.location.pathname || url.search !== window.location.search;
  if (options.replace) window.history.replaceState(window.history.state, "", next);
  else window.history.pushState(null, "", next);
  if (pathChanged && options.scroll !== false) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  emit();
}

/** Sets only the hash (tabs). Replaces by default so tab switches do not flood history. */
export function setHash(hash: string, options: NavigateOptions = { replace: true }): void {
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  navigate(clean ? `#${encodeURIComponent(clean)}` : window.location.pathname + window.location.search, options);
}

export function back(): void {
  if (typeof window !== "undefined") window.history.back();
}

// ---------------------------------------------------------------- typed path matching

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

export type PathParams<P extends string> = { [K in ParamNames<P>]: string };

/**
 * Matches a pattern like "/e/:slug" or "/admin/pagos/:id" against a path. Segments are compared
 * exactly; params are decoded. A trailing "/*" matches any remainder.
 */
export function matchPath<P extends string>(pattern: P, path: string): PathParams<P> | null {
  const wildcard = pattern.endsWith("/*");
  const patternParts = normalizePath(wildcard ? pattern.slice(0, -2) : pattern).split("/").filter(Boolean);
  const pathParts = normalizePath(path).split("/").filter(Boolean);
  if (wildcard ? pathParts.length < patternParts.length : pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] ?? "";
    const actual = pathParts[i] ?? "";
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return toParams<P>(params);
}

function toParams<P extends string>(params: Record<string, string>): PathParams<P> {
  // Every key in ParamNames<P> was filled from the pattern above, so the record has the declared shape.
  const typed: { [key: string]: string } = params;
  return typed as PathParams<P>;
}

// ---------------------------------------------------------------- link click handling

/** True when a click should be left to the browser (new tab, download, modifier keys, other origin). */
export function shouldBypassRouter(event: MouseEvent | ReactMouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.defaultPrevented || event.button !== 0) return true;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return true;
  if (anchor.target && anchor.target !== "_self") return true;
  if (anchor.hasAttribute("download")) return true;
  if (anchor.origin !== window.location.origin) return true;
  return false;
}
