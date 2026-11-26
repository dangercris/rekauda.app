import type { BillingStatus } from "./billing-status";
import type { Tenant } from "./tenant";

/** Phase 1 stub: there is no billing yet, so every tenant is in good standing. */
export class AlwaysActive implements BillingStatus {
  async isActive(_tenant: Tenant): Promise<boolean> {
    return true;
  }
}
