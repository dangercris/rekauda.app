import type { Tenant, TenantSource } from "../tenancy/tenant";

/** Fixed identity of the single tenant of a self-hosted instance, so provisioning is idempotent. */
export const SELF_HOST_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const SELF_HOST_SLUG = "self-host";
export const SELF_HOST_OWNER_ID = "00000000-0000-4000-8000-000000000002";
/** Reserved TLD (RFC 2606): the synthetic owner can never receive mail. */
export const SELF_HOST_OWNER_EMAIL = "owner@self-host.invalid";

const SOURCES: readonly TenantSource[] = ["cloud", "self_host", "pilot_import"];

interface TenantRow {
  id: string;
  slug: string;
  r2_prefix: string;
  source: string;
}

function toTenant(row: TenantRow | null): Tenant | null {
  const source = SOURCES.find((s) => s === row?.source);
  return row && source ? Object.freeze({ id: row.id, slug: row.slug, r2Prefix: row.r2_prefix, source }) : null;
}

/**
 * Platform-level access to the tables that decide WHICH tenant a request belongs to (tenants, tenant_domains, users,
 * memberships). It runs before any tenant exists, so it is the one data path that is not a TenantDb. Handlers never get it.
 */
export class PlatformDb {
  constructor(private readonly db: D1Database) {}

  /**
   * Active tenant owning this lowercase hostname, or null (unknown, suspended and unverified look the same).
   * Platform-created subdomains resolve as is. A custom domain resolves only once verified_at is set.
   */
  async findActiveTenantByHostname(hostname: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare(
        `SELECT t.id, t.slug, t.r2_prefix, t.source FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
         WHERE d.hostname = ?1 AND t.status = 'active' AND (d.kind = 'subdomain' OR d.verified_at IS NOT NULL)`,
      )
      .bind(hostname)
      .first<TenantRow>();
    return toTenant(row);
  }

  async findSelfHostTenant(): Promise<Tenant | null> {
    const row = await this.db
      .prepare(
        `SELECT id, slug, r2_prefix, source FROM tenants WHERE id = ?1 AND source = 'self_host' AND status = 'active'
         AND NOT EXISTS (SELECT 1 FROM tenants WHERE source = 'cloud')`,
      )
      .bind(SELF_HOST_TENANT_ID)
      .first<TenantRow>();
    return toTenant(row);
  }

  /**
   * Inserts the self-host tenant, its synthetic owner and the membership, then verifies all three rows exist.
   * Returns false without writing when the database already holds a cloud tenant (a self-host instance never serves
   * a multi-tenant database). Throws when a row could not be created, for example because another tenant owns the
   * empty r2_prefix or the owner email is taken: ON CONFLICT DO NOTHING must not hide a half-provisioned instance.
   */
  async provisionSelfHostTenant(nowIso: string): Promise<boolean> {
    if (await this.db.prepare("SELECT 1 AS n FROM tenants WHERE source = 'cloud' LIMIT 1").first()) return false;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO tenants (id, slug, config_json, r2_prefix, source, created_at, updated_at)
           SELECT ?1, ?2, '{}', '', 'self_host', ?3, ?3 WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE source = 'cloud') ON CONFLICT DO NOTHING`,
        )
        .bind(SELF_HOST_TENANT_ID, SELF_HOST_SLUG, nowIso),
      this.db
        .prepare("INSERT INTO users (id, email, kind, created_at) VALUES (?1, ?2, 'synthetic', ?3) ON CONFLICT DO NOTHING")
        .bind(SELF_HOST_OWNER_ID, SELF_HOST_OWNER_EMAIL, nowIso),
      this.db
        .prepare(
          `INSERT INTO memberships (tenant_id, user_id, role, created_at)
           SELECT ?1, ?2, 'owner', ?3 WHERE EXISTS (SELECT 1 FROM tenants WHERE id = ?1) AND EXISTS (SELECT 1 FROM users WHERE id = ?2) ON CONFLICT DO NOTHING`,
        )
        .bind(SELF_HOST_TENANT_ID, SELF_HOST_OWNER_ID, nowIso),
    ]);
    const complete = await this.db
      .prepare(
        `SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner'
         JOIN users u ON u.id = m.user_id AND u.id = ?2 AND u.kind = 'synthetic' AND u.email = ?3
         WHERE t.id = ?1 AND t.source = 'self_host' AND t.r2_prefix = ''`,
      )
      .bind(SELF_HOST_TENANT_ID, SELF_HOST_OWNER_ID, SELF_HOST_OWNER_EMAIL)
      .first();
    if (!complete) throw new Error("self-host provisioning incomplete");
    return true;
  }
}
