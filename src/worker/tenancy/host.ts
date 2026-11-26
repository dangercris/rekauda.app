/** Host parsing for tenant resolution. Pure and fail closed: anything malformed is reported as `invalid`. */

/** Labels that can never be a tenant slug. They live in code, not in the database. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www", "api", "admin", "app", "mail", "in", "static", "assets", "cdn", "status",
  "docs", "help", "login", "auth", "billing", "cloud", "dev", "staging", "test", "demo",
  "support", "security", "abuse", "postmaster", "webmaster", "smtp", "imap", "pop", "ns1", "ns2",
  "blog", "account", "console", "portal", "signup", "rekauda", "autodiscover",
]);

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const PORT = /^\d{1,5}$/;
const NON_ASCII = /[^\x00-\x7f]/;
const MAX_HOST_LENGTH = 253;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

export type ParsedHost =
  | { kind: "invalid" }
  | { kind: "apex" }
  | { kind: "reserved"; label: string }
  | { kind: "subdomain"; slug: string; hostname: string }
  | { kind: "custom"; hostname: string };

/**
 * Rejects non-ASCII input first (some characters lowercase to ASCII, e.g. the Kelvin sign), then trims, lowercases,
 * strips one port (1-65535) and one trailing dot. Returns null when the result is not a plain ASCII DNS name.
 */
export function normalizeHost(raw: string): string | null {
  if (NON_ASCII.test(raw)) return null;
  let host = raw.trim().toLowerCase();
  const colon = host.lastIndexOf(":");
  if (colon >= 0) {
    const port = host.slice(colon + 1);
    if (!PORT.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "" || host.length > MAX_HOST_LENGTH) return null;
  return host.split(".").every((label) => DNS_LABEL.test(label)) ? host : null;
}

/** DNS-safe (no punycode-looking double hyphen), within length bounds and not reserved. */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG.test(slug) &&
    !slug.includes("--") &&
    !RESERVED_SUBDOMAINS.has(slug)
  );
}

/** Classifies a Host header against the root domain (`localhost` in local development). */
export function parseHost(rawHost: string, rootDomain: string): ParsedHost {
  const host = normalizeHost(rawHost);
  const root = normalizeHost(rootDomain);
  if (host === null || root === null) return { kind: "invalid" };
  if (host === root || host === `www.${root}`) return { kind: "apex" };
  if (!host.endsWith(`.${root}`)) return { kind: "custom", hostname: host };
  const label = host.slice(0, -(root.length + 1));
  if (label.includes(".")) return { kind: "invalid" };
  if (RESERVED_SUBDOMAINS.has(label)) return { kind: "reserved", label };
  return isValidSlug(label) ? { kind: "subdomain", slug: label, hostname: host } : { kind: "invalid" };
}
