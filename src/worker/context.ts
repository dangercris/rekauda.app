import { TenantDb } from "./data/tenant-db";
import { TenantStorage } from "./storage/tenant-storage";
import type { Tenant } from "./tenancy/tenant";

/**
 * Everything a tenant handler may use. There is deliberately no raw D1, R2 or env here: data goes through the
 * tenant-bound TenantDb and files through TenantStorage. Runtime config joins this in the runtime-config slice.
 */
export interface RequestContext {
  tenant: Tenant;
  db: TenantDb;
  storage: TenantStorage;
}

/** Called by the composition root, which is the only place that holds the raw bindings. */
export function buildContext(tenant: Tenant, bindings: { db: D1Database; files: R2Bucket }): RequestContext {
  return { tenant, db: new TenantDb(bindings.db, tenant.id), storage: new TenantStorage(bindings.files, tenant) };
}
