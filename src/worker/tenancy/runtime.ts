import type { Instance } from "../../shared/instance";
import { TtlCache } from "./cache";
import { BundledConfigStore } from "./config-store";
import type { SingleTenantResolver } from "./resolver";
import type { Tenant } from "./tenant";

/**
 * Per-isolate tenancy state. One deployment has one database, so a module-level singleton is enough. It holds only
 * public tenant data and resolver bookkeeping, never request state.
 */
export const tenancyState: {
  hostCache: TtlCache<Tenant>;
  configCache: TtlCache<Instance>;
  configLastGood: Map<string, Instance>;
  single: SingleTenantResolver | null;
  bundled: BundledConfigStore;
} = {
  hostCache: new TtlCache<Tenant>(),
  configCache: new TtlCache<Instance>(),
  configLastGood: new Map<string, Instance>(),
  single: null,
  bundled: new BundledConfigStore(),
};

/** Tests call this between cases so databases never share a cache. */
export function resetTenancyState(): void {
  tenancyState.hostCache = new TtlCache<Tenant>();
  tenancyState.configCache = new TtlCache<Instance>();
  tenancyState.configLastGood = new Map<string, Instance>();
  tenancyState.single = null;
  tenancyState.bundled = new BundledConfigStore();
}
