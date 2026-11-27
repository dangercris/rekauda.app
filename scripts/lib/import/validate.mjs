// prod:validate. Re-reads the Cloud rows of the imported tenant and compares them with what the plan should have produced:
// per table the row count, the sums of the money columns, the counts by status and by collection, and an ordered digest of
// the canonical rows. ONE function (`summarize`) computes all of it for both sides, so they cannot drift apart. Output is
// MATCH or MISMATCH plus counts and metric names, never row content or ids. No automatic fixing. No dependencies.
import { canonicalDigest } from "./canonical.mjs";
import { IMPORT_TABLES } from "./columns.mjs";
import { loadPlanState } from "./plan.mjs";
import { SLUG, UUID, readTenant } from "./target.mjs";

const SUMS = { payments: ["amount_cents", "expected_cents"], students: ["option_cents"], bank_movements: ["amount_cents"] };
const GROUPS = { collections: ["status"], payments: ["status", "collection_id"], bank_movements: ["match_status"] };
export const MISMATCH_STATUS = 4;

/** Counts of the rows per value of one column, as sorted [value, count] pairs (a Map, so odd ids are safe keys). */
function groupBy(rows, column) {
  const counts = new Map();
  for (const row of rows) counts.set(String(row[column]), (counts.get(String(row[column])) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `tables` is { collections, payments, students, bank_movements } of row objects. Throws when a column is missing or odd. */
export function summarize(tables) {
  const summary = { counts: {}, sums: {}, groups: {}, digests: {} };
  for (const table of IMPORT_TABLES) {
    const rows = tables[table];
    summary.counts[table] = rows.length;
    summary.digests[table] = canonicalDigest(table, rows);
    summary.sums[table] = Object.fromEntries((SUMS[table] ?? []).map((c) => [c, String(rows.reduce((total, row) => total + (row[c] === null ? 0n : BigInt(row[c])), 0n))]));
    summary.groups[table] = Object.fromEntries((GROUPS[table] ?? []).map((c) => [c, groupBy(rows, c)]));
  }
  return summary;
}

/** Flat metric name -> value, so a comparison can name what differs without showing any data. */
function flatten({ counts, sums, groups, digests }) {
  const metrics = new Map();
  for (const [t, n] of Object.entries(counts)) metrics.set(`${t}.count`, n);
  for (const [t, cols] of Object.entries(sums)) for (const [c, v] of Object.entries(cols)) metrics.set(`${t}.sum.${c}`, v);
  for (const [t, cols] of Object.entries(groups)) for (const [c, v] of Object.entries(cols)) metrics.set(`${t}.by.${c}`, v);
  for (const [t, v] of Object.entries(digests)) metrics.set(`${t}.digest`, v);
  return metrics;
}

/** Names of the metrics that differ, sorted. Empty means the two sides match. */
export function compareSummaries(expected, actual) {
  const a = flatten(expected);
  const b = flatten(actual);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).sort();
}

export function runValidate({ dir, manifest, tenantId, slug }, { remote, log = console }) {
  const refuse = (why) => (log.error(`[validate] REFUSED: ${why}`), 1);
  if (!UUID.test(tenantId) || !SLUG.test(slug)) return refuse("bad tenant id or slug.");
  let plan;
  try {
    plan = loadPlanState(dir, manifest, tenantId);
  } catch {
    return refuse("the import plan is missing or stale; run pilot:import:plan again.");
  }
  let expected;
  let actual;
  try {
    const tenant = readTenant(remote, tenantId);
    if (tenant?.source !== "pilot_import" || tenant.slug !== slug) return refuse("the target tenant is not the expected pilot_import tenant.");
    const readBack = Object.fromEntries(IMPORT_TABLES.map((t) => [t, remote.select(`SELECT * FROM ${t} WHERE tenant_id = '${tenantId}' ORDER BY id;`)]));
    expected = summarize(plan.tables);
    actual = summarize(readBack);
  } catch {
    log.error("[validate] FAILED: the Cloud rows could not be read back (no details are shown on purpose).");
    return 1;
  }
  log.log(`[validate] cloud ${IMPORT_TABLES.map((t) => `${t}=${actual.counts[t]}`).join(" ")}`);
  const differing = compareSummaries(expected, actual);
  if (differing.length === 0) {
    log.log("[validate] MATCH");
    return 0;
  }
  log.error(`[validate] MISMATCH: ${differing.join(", ")}`);
  return MISMATCH_STATUS;
}
