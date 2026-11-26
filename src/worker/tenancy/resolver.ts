import { fail } from "../http";
import type { PlatformDb } from "../data/platform-db";
import { TtlCache } from "./cache";
import { parseHost } from "./host";
import type { Tenant } from "./tenant";

export interface TenantResolver {
  /** The tenant for this Host header, or null. Null covers unknown, suspended, reserved, apex and malformed alike. */
  resolve(host: string): Promise<Tenant | null>;
}

/** One response for every null resolution, so callers cannot tell why a host was refused. */
export function tenantNotFound(): Response {
  return fail(404, "not_found", "No encontramos esta página.");
}

/** Cloud: `<slug>.<root domain>` and custom domains, looked up in tenant_domains through a per-isolate cache. */
export class HostTenantResolver implements TenantResolver {
  constructor(
    private readonly platform: Pick<PlatformDb, "findActiveTenantByHostname">,
    private readonly rootDomain: string,
    private readonly cache: TtlCache<Tenant> = new TtlCache(),
  ) {}

  async resolve(rawHost: string): Promise<Tenant | null> {
    const parsed = parseHost(rawHost, this.rootDomain);
    if (parsed.kind !== "subdomain" && parsed.kind !== "custom") return null;
    const cached = this.cache.get(parsed.hostname);
    if (cached) return cached.value;
    const tenant = await this.platform.findActiveTenantByHostname(parsed.hostname);
    this.cache.set(parsed.hostname, tenant);
    return tenant;
  }
}

const SINGLE_KEY = "single";

/**
 * Self-host: every host maps to the one tenant, provisioned lazily (idempotent) on first use. Provisioning is
 * remembered, the lookup is not: every resolve re-reads the tenant, which also re-checks that no cloud tenant exists,
 * so it stops serving as soon as the database stops being single-tenant. Resolves to null when a cloud tenant exists
 * and throws when provisioning cannot complete.
 */
export class SingleTenantResolver implements TenantResolver {
  private provisioned: Promise<boolean> | null = null;

  constructor(
    private readonly platform: Pick<PlatformDb, "provisionSelfHostTenant" | "findSelfHostTenant">,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(_host: string): Promise<Tenant | null> {
    this.provisioned ??= this.platform.provisionSelfHostTenant(new Date(this.now()).toISOString()).catch((error: unknown) => {
      this.provisioned = null;
      throw error;
    });
    if (!(await this.provisioned)) {
      this.provisioned = null;
      return null;
    }
    return this.platform.findSelfHostTenant();
  }
}
