// prod:undo-data and prod:undo-tenant. Plain DELETEs scoped to ONE tenant, in reverse foreign-key order, each guarded by an
// EXISTS on the tenant being a pilot_import tenant, so a wrong id can never touch a normal tenant.
// NOT LIVE YET: an undo needs the import workdir and refuses unless every row currently in the tenant belongs to the plan
// (ids compared locally from SELECT-only id reads; students by count, their ids are regenerated). So it removes an untouched
// or partial import and refuses once parents have created new data. Without the workdir the runbook covers manual removal.
// The tenant level also removes sessions, magic links, memberships, every user whose only membership was this tenant (any
// role) and the domains and the tenant row, last. A user cannot be deleted while a membership references it, so the user
// ids are written to the workdir BEFORE the first DELETE: a rerun after a crash at any step finishes the job.
// Idempotent. Counts only in the output. No dependencies.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_TABLES } from "./columns.mjs";
import { COLLISION_TABLES } from "./collisions.mjs";
import { loadPlanIds } from "./plan.mjs";
import { SLUG, UUID, readRowCounts, readTenant } from "./target.mjs";

const PLAIN_ID = /^[A-Za-z0-9._-]{1,64}$/;
const USERS_FILE = "undo-users.json";
const GUARD = (id) => `EXISTS (SELECT 1 FROM tenants WHERE id = '${id}' AND source = 'pilot_import')`;
const scoped = (table, id) => `DELETE FROM ${table} WHERE tenant_id = '${id}' AND ${GUARD(id)};`;

/** The DELETE statements, in order. `userIds` are the members of the tenant, read before the memberships are removed. */
export function undoStatements(tenantId, { tenant, userIds = [] }) {
  if (!UUID.test(tenantId) || !userIds.every((id) => typeof id === "string" && PLAIN_ID.test(id))) throw new Error("bad id");
  const data = [...IMPORT_TABLES].reverse().map((table) => scoped(table, tenantId));
  if (!tenant) return data;
  const users = userIds.map((u) => `DELETE FROM users WHERE id = '${u}' AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '${u}') AND ${GUARD(tenantId)};`);
  return [...data, scoped("sessions", tenantId), scoped("magic_links", tenantId), scoped("memberships", tenantId), ...users, scoped("tenant_domains", tenantId), `DELETE FROM tenants WHERE id = '${tenantId}' AND source = 'pilot_import';`];
}

const REFUSE_WORKDIR = "needs the workdir of the import (its plan). If the workdir is gone, remove the data by hand as the runbook describes.";

/** User ids recorded by an earlier, interrupted run (a missing or odd file means none). */
function recordedUsers(dir) {
  try {
    const ids = JSON.parse(readFileSync(join(dir, USERS_FILE), "utf8"));
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && PLAIN_ID.test(id)) : [];
  } catch {
    return [];
  }
}

export function runUndo({ dir, manifest, tenantId, slug, tenantLevel }, { remote, log = console }) {
  const refuse = (why) => (log.error(`[undo] REFUSED: ${why}`), 1);
  if (!UUID.test(tenantId) || !SLUG.test(slug)) return refuse("bad tenant id or slug.");
  let plan;
  try {
    plan = loadPlanIds(dir, manifest, tenantId);
  } catch {
    return refuse(REFUSE_WORKDIR);
  }
  let statements = [];
  let userIds = [];
  try {
    const tenant = readTenant(remote, tenantId);
    if (tenant === null && tenantLevel) userIds = recordedUsers(dir);
    else {
      if (tenant?.source !== "pilot_import" || tenant.slug !== slug) return refuse("the target tenant is not the expected pilot_import tenant.");
      for (const table of COLLISION_TABLES) {
        const rows = remote.select(`SELECT id FROM ${table} WHERE tenant_id = '${tenantId}' ORDER BY id;`);
        if (rows.some((row) => !plan.ids[table].has(row.id))) return refuse("the tenant has data that is not part of the import (it may be live). Nothing was deleted.");
      }
      if (readRowCounts(remote, tenantId).students > plan.students) return refuse("the tenant has data that is not part of the import (it may be live). Nothing was deleted.");
      if (tenantLevel) {
        const members = remote.select(`SELECT user_id FROM memberships WHERE tenant_id = '${tenantId}';`).map((row) => row.user_id);
        userIds = [...new Set([...recordedUsers(dir), ...members])];
        writeFileSync(join(dir, USERS_FILE), JSON.stringify(userIds), { mode: 0o600 });
      }
      statements = undoStatements(tenantId, { tenant: tenantLevel, userIds });
    }
  } catch {
    return refuse("the target could not be read (no details are shown on purpose).");
  }
  try {
    for (const sql of statements) remote.mutate(sql);
    const counts = readRowCounts(remote, tenantId);
    log.log(`[undo] ${IMPORT_TABLES.map((t) => `${t}=${counts[t]}`).join(" ")}`);
    let left = IMPORT_TABLES.some((t) => counts[t] !== 0);
    if (tenantLevel) {
      const ids = userIds.map((u) => `'${u}'`).join(", ");
      const rest = remote.select(`SELECT (SELECT COUNT(*) FROM memberships WHERE tenant_id = '${tenantId}') AS memberships, (SELECT COUNT(*) FROM sessions WHERE tenant_id = '${tenantId}') AS sessions, (SELECT COUNT(*) FROM magic_links WHERE tenant_id = '${tenantId}') AS magic_links, (SELECT COUNT(*) FROM tenant_domains WHERE tenant_id = '${tenantId}') AS tenant_domains, (SELECT COUNT(*) FROM users WHERE id IN (${ids}) AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = users.id)) AS sole_users;`);
      left = left || rest.length !== 1 || Object.values(rest[0]).some((n) => n !== 0) || readTenant(remote, tenantId) !== null;
    }
    if (left) throw new Error("rows remain");
  } catch {
    log.error("[undo] FAILED: the undo is not complete (no details are shown on purpose). It is safe to run it again.");
    return 1;
  }
  log.log(tenantLevel ? "[undo] tenant removed." : "[undo] tenant data removed, the tenant is kept.");
  return 0;
}
