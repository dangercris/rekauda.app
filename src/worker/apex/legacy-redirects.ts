// Shared parser for the LEGACY_REDIRECTS map, used by the Worker (apex mode) AND the production guard.
// ZERO imports on purpose: the guard loads this file directly in Node (type stripping), and a scan test enforces it.
// The map is deploy-time config (a var), never code or data: an entry is key `/r/<slug>` and value exactly
// `https://<slug>.<root>/r/<same slug>`, so it can only point at a tenant host under our own root (no open redirect).
// One invalid entry rejects the WHOLE map (fail closed).

const MAX_ENTRIES = 20;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Same rules as isValidSlug (src/worker/tenancy/host.ts): 3-40 characters, no "--", not reserved. Inlined because this file has
// ZERO imports; a parity test compares the two so they cannot drift. This also refuses /r/www (a self-redirect loop) and /r/api.
const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 40;
export const LEGACY_RESERVED_LABELS: readonly string[] = [
  "www", "api", "admin", "app", "mail", "in", "static", "assets", "cdn", "status",
  "docs", "help", "login", "auth", "billing", "cloud", "dev", "staging", "test", "demo",
  "support", "security", "abuse", "postmaster", "webmaster", "smtp", "imap", "pop", "ns1", "ns2",
  "blog", "account", "console", "portal", "signup", "rekauda", "autodiscover",
];
const ROOT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const KEY = /^\/r\/([^/]+)$/;

export type LegacyRedirects = Readonly<Record<string, string>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True when `raw` is a plain object (possibly empty) whose every entry follows the rule above, for this root. */
export function legacyRedirectsValid(raw: unknown, root: unknown): boolean {
  if (typeof root !== "string" || !ROOT.test(root) || !isPlainObject(raw)) return false;
  const entries = Object.entries(raw);
  if (entries.length > MAX_ENTRIES) return false;
  return entries.every(([key, value]) => {
    const slug = KEY.exec(key)?.[1];
    return slug !== undefined && slug.length >= MIN_SLUG_LENGTH && slug.length <= MAX_SLUG_LENGTH && SLUG.test(slug) && !slug.includes("--") && !LEGACY_RESERVED_LABELS.includes(slug) && value === `https://${slug}.${root}/r/${slug}`;
  });
}

/** The validated map as a copy, or an empty map when anything is wrong (absent, malformed, open redirect, too big). */
export function parseLegacyRedirects(raw: unknown, root: unknown): LegacyRedirects {
  return legacyRedirectsValid(raw, root) ? Object.fromEntries(Object.entries(raw as Record<string, string>)) : {};
}
