// Reads of the production target for the import tools. Every statement is a SELECT built from constants and from ids that
// were validated first (a UUID and a slug), or from plan ids that already passed the preflight pattern. `remote.select`
// returns the rows of one statement and throws a generic error on any failure. Nothing here prints. No dependencies.
import { collisionQueries } from "./collisions.mjs";
import { IMPORT_TABLES } from "./columns.mjs";
import { evaluateTarget } from "./preflight.mjs";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The tenant row, or null when it does not exist. */
export function readTenant(remote, tenantId) {
  const rows = remote.select(`SELECT id, slug, source FROM tenants WHERE id = '${tenantId}';`);
  if (rows.length > 1) throw new Error("unreadable");
  return rows.length === 0 ? null : { id: rows[0].id, slug: rows[0].slug, source: rows[0].source };
}

/** Rows of the tenant in the four data tables. */
export function readRowCounts(remote, tenantId) {
  const parts = IMPORT_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t} WHERE tenant_id = '${tenantId}') AS ${t}`);
  const rows = remote.select(`SELECT ${parts.join(", ")};`);
  if (rows.length !== 1) throw new Error("unreadable");
  return Object.fromEntries(IMPORT_TABLES.map((t) => [t, rows[0][t]]));
}

/** How many plan ids already exist anywhere in the target (global primary keys). NaN when a result is unreadable. */
export function readCollisions(remote, planTables) {
  let total = 0;
  for (const sql of collisionQueries(planTables)) {
    const rows = remote.select(sql);
    total += rows.length === 1 && Number.isSafeInteger(rows[0].n) ? rows[0].n : NaN;
  }
  return total;
}

/** Target preflight with REAL data: tenant, row counts and id collisions, judged by the pure evaluateTarget. */
export function targetVerdict(remote, planTables, { tenantId, slug }) {
  const state = { tenant: readTenant(remote, tenantId), rows: readRowCounts(remote, tenantId), collidingIds: readCollisions(remote, planTables) };
  return evaluateTarget(state, { slug, tenantId });
}
