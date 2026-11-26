import type { ProvisionTenantInput } from "./provision-tenant-input";
import type { Tenant } from "./tenant";

/** Creates a cloud tenant with its subdomain and owner. Not wired to any route yet (the signup wizard is phase 2). */
export interface TenantProvisioner {
  provision(input: ProvisionTenantInput): Promise<Tenant>;
}
