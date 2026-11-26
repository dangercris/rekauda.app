import type { Tenant } from "../tenancy/tenant";
import { isRelativeKey, tenantPrefix } from "./keys";

export class TenantStorageViolation extends Error {}

type StorageTenant = Pick<Tenant, "id" | "r2Prefix" | "source">;
type PutValue = string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob;

/**
 * R2 access bound to one tenant. Writes take a relative key and return the full key to store in the row.
 * Reads, heads and deletes take full keys and refuse anything outside this tenant's prefix before touching the bucket.
 */
export class TenantStorage {
  private readonly prefix: string;

  constructor(
    private readonly bucket: R2Bucket,
    tenant: StorageTenant,
  ) {
    const own = tenant.r2Prefix === tenantPrefix(tenant.id);
    if (!own && !(tenant.r2Prefix === "" && tenant.source !== "cloud")) throw new TenantStorageViolation("invalid tenant prefix");
    this.prefix = tenant.r2Prefix;
  }

  async put(relativeKey: string, value: PutValue, options?: Omit<R2PutOptions, "onlyIf">): Promise<string> {
    if (!isRelativeKey(relativeKey)) throw new TenantStorageViolation("invalid storage key");
    const key = this.prefix + relativeKey;
    await this.bucket.put(key, value, options);
    return key;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(this.owned(key));
  }

  async head(key: string): Promise<R2Object | null> {
    return this.bucket.head(this.owned(key));
  }

  async delete(key: string): Promise<void> {
    return this.bucket.delete(this.owned(key));
  }

  private owned(key: string): string {
    if (!key.startsWith(this.prefix) || !isRelativeKey(key.slice(this.prefix.length))) {
      throw new TenantStorageViolation("storage key is outside the tenant prefix");
    }
    return key;
  }
}
