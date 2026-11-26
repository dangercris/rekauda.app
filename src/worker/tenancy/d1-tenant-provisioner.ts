import { PlatformDb } from "../data/platform-db";
import { parseInstanceConfig } from "../../shared/instance-validation";
import { isValidSlug } from "./host";
import type { ProvisionTenantInput } from "./provision-tenant-input";
import type { Tenant } from "./tenant";
import type { TenantProvisioner } from "./tenant-provisioner";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Provisions through PlatformDb (the data path that runs before a tenant exists). Validates everything before the single atomic write. */
export class D1TenantProvisioner implements TenantProvisioner {
  constructor(
    private readonly platform: PlatformDb,
    private readonly rootDomain: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async provision(input: ProvisionTenantInput): Promise<Tenant> {
    if (!isValidSlug(input.slug)) throw new Error("Invalid slug: it must be 3-40 DNS-safe lowercase characters and not reserved.");
    const email = input.ownerEmail.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error("Invalid owner email.");
    const config = parseInstanceConfig(input.config, "tenant config");
    const id = crypto.randomUUID();
    const created = await this.platform.createCloudTenant({
      id,
      slug: input.slug,
      hostname: `${input.slug}.${this.rootDomain.trim().toLowerCase()}`,
      configJson: JSON.stringify(config),
      ownerEmail: email,
      ownerId: crypto.randomUUID(),
      nowIso: this.now(),
    });
    if (!created) throw new Error("Slug is not available.");
    return created;
  }
}
