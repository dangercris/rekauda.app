// prod:undo-data and prod:undo-tenant. Plain DELETEs scoped to ONE tenant, in reverse foreign-key order, each guarded by an
// EXISTS on the tenant being a pilot_import tenant, so a wrong id can never touch a normal tenant. The tenant level also
// removes the tenant's sessions, magic links, memberships, domains and row, and the owner user only when it has no other
// membership. Idempotent: running it again after a failure is safe. Counts only in the output. No dependencies.
import { IMPORT_TABLES } from "./columns.mjs";
import { SLUG, UUID, readRowCounts, readTenant } from "./target.mjs";

const PLAIN_ID = /^[A-Za-z0-9._-]{1,64}$/;
const GUARD = (id) => `EXISTS (SELECT 1 FROM tenants WHERE id = '${id}' AND source = 'pilot_import')`;
const scoped = (table, id) => `DELETE FROM ${table} WHERE tenant_id = '${id}' AND ${GUARD(id)};`;

/** The DELETE statements, in order. `ownerIds` are the owner user ids read before the memberships are removed. */
export function undoStatements(tenantId, { tenant, ownerIds = [] }) {
  if (!UUID.test(tenantId) || !ownerIds.every((id) => typeof id === "string" && PLAIN_ID.test(id))) throw new Error("bad id");
  const data = [...IMPORT_TABLES].reverse().map((table) => scoped(table, tenantId));
  if (!tenant) return data;
  const owners = ownerIds.map((u) => `DELETE FROM users WHERE id = '${u}' AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '${u}') AND ${GUARD(tenantId)};`);
  return [...data, scoped("sessions", tenantId), scoped("magic_links", tenantId), scoped("memberships", tenantId), ...owners, scoped("tenant_domains", tenantId), `DELETE FROM tenants WHERE id = '${tenantId}' AND source = 'pilot_import';`];
}

export function runUndo({ tenantId, slug, tenantLevel }, { remote, log = console }) {
  const refuse = (why) => (log.error(`[undo] REFUSED: ${why}`), 1);
  if (!UUID.test(tenantId) || !SLUG.test(slug)) return refuse("bad tenant id or slug.");
  let statements;
  try {
    const tenant = readTenant(remote, tenantId);
    if (tenant?.source !== "pilot_import" || tenant.slug !== slug) return refuse("the target tenant is not the expected pilot_import tenant.");
    const owners = tenantLevel ? remote.select(`SELECT user_id FROM memberships WHERE tenant_id = '${tenantId}' AND role = 'owner';`) : [];
    statements = undoStatements(tenantId, { tenant: tenantLevel, ownerIds: owners.map((row) => row.user_id) });
  } catch {
    return refuse("the target could not be read (no details are shown on purpose).");
  }
  try {
    for (const sql of statements) remote.mutate(sql);
    const counts = readRowCounts(remote, tenantId);
    log.log(`[undo] ${IMPORT_TABLES.map((t) => `${t}=${counts[t]}`).join(" ")}`);
    if (IMPORT_TABLES.some((t) => counts[t] !== 0) || (tenantLevel && readTenant(remote, tenantId) !== null)) throw new Error("rows remain");
  } catch {
    log.error("[undo] FAILED: the undo is not complete (no details are shown on purpose). It is safe to run it again.");
    return 1;
  }
  log.log(tenantLevel ? "[undo] tenant removed." : "[undo] tenant data removed, the tenant is kept.");
  return 0;
}
