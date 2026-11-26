import type { InstanceConfig } from "../../shared/instance-config";

export interface ProvisionTenantInput {
  /** Becomes `<slug>.<root domain>`. Must pass `isValidSlug`. */
  slug: string;
  /** The person who becomes the tenant owner. */
  ownerEmail: string;
  /** Public runtime config. Validated with the same rules as a stored `config_json`. */
  config: InstanceConfig;
}
