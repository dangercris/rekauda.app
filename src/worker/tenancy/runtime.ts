import { TtlCache } from "./cache";
import type { SingleTenantResolver } from "./resolver";
import type { Tenant } from "./tenant";

/**
 * Per-isolate tenancy state. One deployment has one database, so a module-level singleton is enough. It holds only
 * public tenant data and resolver bookkeeping, never request state.
 */
export const tenancyState: { hostCache: TtlCache<Tenant>; single: SingleTenantResolver | null } = {
  hostCache: new TtlCache<Tenant>(),
  single: null,
};

/** Tests call this between cases so databases never share a cache. */
export function resetTenancyState(): void {
  tenancyState.hostCache = new TtlCache<Tenant>();
  tenancyState.single = null;
}
