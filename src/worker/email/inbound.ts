import type { PlatformDb } from "../data/platform-db";
import { sha256Hex } from "../ids";
import type { Tenant } from "../tenancy/tenant";

/** `d-<token>`: the token is lowercase alphanumeric (generated with `openssl rand -hex 16`). Plus-addressing variants never match. */
const LOCAL_PART = /^d-([a-z0-9]{16,64})$/;

/**
 * The token of an inbound recipient `d-<token>@<inboundDomain>`, or null. Case is normalised and one trailing dot of the
 * domain is tolerated; anything else (another domain, a sub-domain, `+tag`, display names, control characters) is refused.
 */
export function parseInboundAddress(to: string, inboundDomain: string): string | null {
  // Before lowercasing: some non-ASCII characters lowercase to ASCII letters (the Kelvin sign becomes "k").
  if (/[^\x00-\x7f]/.test(to)) return null;
  const address = to.trim().toLowerCase();
  const parts = address.split("@");
  if (parts.length !== 2) return null;
  const [local = "", domain = ""] = parts;
  if (domain.replace(/\.$/, "") !== inboundDomain.toLowerCase()) return null;
  return LOCAL_PART.exec(local)?.[1] ?? null;
}

/** The ACTIVE tenant that owns the recipient's token (compared by SHA-256 hash), or null. Reads no message content. */
export async function resolveInboundTenant(to: string, inboundDomain: string, platform: Pick<PlatformDb, "findActiveTenantByInboundTokenHash">): Promise<Tenant | null> {
  const token = parseInboundAddress(to, inboundDomain);
  return token ? platform.findActiveTenantByInboundTokenHash(await sha256Hex(new TextEncoder().encode(token))) : null;
}
