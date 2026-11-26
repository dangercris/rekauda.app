import config from "../../../rekauda.config";
import { resolveInstance, type Instance } from "../../shared/instance";
import { parseInstanceConfig } from "../../shared/instance-validation";
import type { PlatformDb } from "../data/platform-db";
import type { TtlCache } from "./cache";
import type { Tenant } from "./tenant";

/** Where a tenant's runtime config comes from. Null means "no usable config": callers must refuse to serve the tenant. */
export interface ConfigStore {
  load(tenant: Tenant): Promise<Instance | null>;
}

/** Single mode (self-host): the config bundled at build time, resolved on first use, never at module load. */
export class BundledConfigStore implements ConfigStore {
  private resolved: Instance | null = null;

  async load(_tenant: Tenant): Promise<Instance | null> {
    this.resolved ??= resolveInstance(config);
    return this.resolved;
  }
}

const FAILURE_TTL_MS = 10_000;
const MAX_STALE = 500;

/** Only this exact asset of the tenant's own prefix can back the QR image. */
const QR_EXT = /^(png|jpg|webp)$/;

/** D1 timestamps are UTC. Without an explicit zone `Date.parse` would read a date-time as local time, so add one. */
function asUtc(timestamp: string): string {
  const iso = timestamp.trim().replace(" ", "T");
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(iso) || !iso.includes("T") ? iso : `${iso}Z`;
}

function qrUrlFor(tenant: Tenant, qrKey: string | null, updatedAt: string): string | null {
  const prefix = `${tenant.r2Prefix}assets/deuna-qr.`;
  if (!qrKey?.startsWith(prefix) || !QR_EXT.test(qrKey.slice(prefix.length))) return null;
  const version = Date.parse(asUtc(updatedAt));
  return `/api/assets/deuna-qr.${qrKey.slice(prefix.length)}?v=${Number.isFinite(version) ? version.toString(36) : "0"}`;
}

/**
 * Multi mode: `tenants.config_json`, validated with the same rules as the bundled config. Invalid JSON, a rule
 * violation, an inactive or unknown tenant all give null (fail closed) and a log line that names the field, never a value.
 * `treasury.qrUrl` is NOT taken from the JSON: it points at the tenant's own R2 asset or is null, so a tenant can
 * never make its page link to an arbitrary same-origin path. Results are cached per isolate (60 s, misses 15 s).
 * A D1 error is not a verdict on the config: the last good value is served (stale-if-error), and without one the
 * failure is negative-cached for 10 s so a database incident is not hammered. Callers then answer a generic 503.
 * Whoever writes `qr_key` must bump `updated_at` in the same statement: it is the QR cache-busting version.
 */
export class D1ConfigStore implements ConfigStore {
  constructor(
    private readonly platform: Pick<PlatformDb, "readTenantConfig">,
    private readonly cache: TtlCache<Instance>,
    /** Last good config per tenant, bounded. Per-isolate state, so the composition root passes a long-lived map. */
    private readonly lastGood: Map<string, Instance> = new Map(),
  ) {}

  async load(tenant: Tenant): Promise<Instance | null> {
    const cached = this.cache.get(tenant.id);
    if (cached) return cached.value;
    let row: Awaited<ReturnType<PlatformDb["readTenantConfig"]>>;
    try {
      row = await this.platform.readTenantConfig(tenant.id);
    } catch {
      // The engine's message may quote SQL or values, so only the fact is logged.
      console.error(JSON.stringify({ level: "error", message: "tenant_config_unavailable", tenantId: tenant.id }));
      const stale = this.lastGood.get(tenant.id) ?? null;
      this.cache.set(tenant.id, stale, FAILURE_TTL_MS);
      return stale;
    }
    const instance = row ? this.parse(tenant, row) : null;
    this.cache.set(tenant.id, instance);
    if (instance) {
      this.lastGood.delete(tenant.id);
      this.lastGood.set(tenant.id, instance);
      if (this.lastGood.size > MAX_STALE) this.lastGood.delete(this.lastGood.keys().next().value as string);
    } else this.lastGood.delete(tenant.id);
    return instance;
  }

  private parse(tenant: Tenant, row: { configJson: string; qrKey: string | null; updatedAt: string }): Instance | null {
    try {
      let json: unknown;
      try {
        json = JSON.parse(row.configJson);
      } catch {
        // The engine's parse error quotes part of the text, so it is not forwarded.
        throw new Error("Invalid tenant config: config_json must be valid JSON.");
      }
      const parsed = parseInstanceConfig(json, "tenant config");
      return resolveInstance({ ...parsed, treasury: { ...parsed.treasury, qrUrl: qrUrlFor(tenant, row.qrKey, row.updatedAt) } }, "tenant config");
    } catch (e) {
      console.error(JSON.stringify({ level: "error", message: "tenant_config_invalid", tenantId: tenant.id, detail: e instanceof Error ? e.message : "unknown" }));
      return null;
    }
  }
}
