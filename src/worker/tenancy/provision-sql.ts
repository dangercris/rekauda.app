// Pure statement builder for provisioning a tenant. ZERO imports on purpose: the Worker (PlatformDb.createCloudTenant) binds
// these statements to D1, and the provisioning CLI loads this file directly in Node (type stripping) to render them as
// literal SQL. A runtime import here would break the CLI, and a scan test enforces it.

/** Same rule D1TenantProvisioner applies to the owner email (after trim and lowercase). */
export const OWNER_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProvisionSource = "cloud" | "pilot_import";

export interface ProvisionRow {
  id: string;
  slug: string;
  hostname: string;
  configJson: string;
  ownerEmail: string;
  ownerId: string;
  nowIso: string;
  source: ProvisionSource;
  /** Full R2 key of the Deuna QR, when it was uploaded before the tenant row is written. */
  qrKey?: string | null;
  /** SHA-256 of the inbound mail token. Never the token. */
  inboundTokenHash?: string | null;
}

export interface ProvisionStatement {
  sql: string;
  params: (string | null)[];
}

/**
 * The statements that create a tenant, its platform subdomain, its owner (an existing person is reused) and the owner
 * membership, in foreign-key order. `?n` placeholders are numbered per statement. The caller validates the input first.
 * Whoever writes `qr_key` bumps `updated_at` in the same statement (it is the QR cache version): here both are set at insert.
 */
export function provisionTenantStatements(row: ProvisionRow): ProvisionStatement[] {
  if (row.source !== "cloud" && row.source !== "pilot_import") throw new Error("unsupported tenant source");
  return [
    {
      sql: `INSERT INTO tenants (id, slug, config_json, r2_prefix, source, qr_key, inbound_token_hash, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      params: [row.id, row.slug, row.configJson, `t/${row.id}/`, row.source, row.qrKey ?? null, row.inboundTokenHash ?? null, row.nowIso],
    },
    {
      sql: "INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES (?1, ?2, 'subdomain', ?3)",
      params: [row.hostname, row.id, row.nowIso],
    },
    {
      sql: "INSERT INTO users (id, email, kind, created_at) VALUES (?1, ?2, 'person', ?3) ON CONFLICT DO NOTHING",
      params: [row.ownerId, row.ownerEmail, row.nowIso],
    },
    {
      sql: `INSERT INTO memberships (tenant_id, user_id, role, created_at)
           SELECT ?1, id, 'owner', ?3 FROM users WHERE email = ?2 AND kind = 'person'`,
      params: [row.id, row.ownerEmail, row.nowIso],
    },
  ];
}
