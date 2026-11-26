/** What the emailed link carries: `/admin#acceso=<43 base64url characters>`. Browsers never send a fragment to a server. */
const FRAGMENT = /^#acceso=([A-Za-z0-9_-]{43})$/;

let captured: string | null = null;

/**
 * Reads the link token from the address bar and removes it from the address bar and history entry (replaceState), so it
 * cannot be bookmarked, shared or read by later scripts. It does NOT sign in: opening a link must never log anyone in by
 * itself (login CSRF: an attacker could send a victim a link for the attacker's own account), so the page asks for a click.
 * Idempotent while the token is held: React StrictMode runs initializers twice in development and the second call would
 * otherwise find the fragment already gone.
 */
export function takeLinkToken(): string | null {
  const token = FRAGMENT.exec(window.location.hash)?.[1];
  if (token) {
    captured = token;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return captured;
}

/** Drops the held token (after it was used, or when a test starts over). */
export function forgetLinkToken(): void {
  captured = null;
}
