import type { Tenant } from "./tenant";

/** Whether a tenant is in good standing. Phase 3 plugs a real implementation in here. Nothing blocks on it yet. */
export interface BillingStatus {
  isActive(tenant: Tenant): Promise<boolean>;
}
