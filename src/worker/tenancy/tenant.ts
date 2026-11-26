export type TenantSource = "cloud" | "self_host" | "pilot_import";

/** Public, non-secret identity of the tenant a request is scoped to. */
export interface Tenant {
  readonly id: string;
  readonly slug: string;
  /** `t/<id>/` for cloud tenants. Empty only for self_host and pilot_import (legacy key shape). */
  readonly r2Prefix: string;
  readonly source: TenantSource;
}
