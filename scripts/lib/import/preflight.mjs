// Preflight over the local pilot snapshot, and the read-only evaluation of the target tenant. Both only return check names
// and counts: never row content, ids or names. No dependencies.
import { isRelativeKey } from "../../../src/worker/storage/keys.ts";
import { TABLES } from "./pilot-snapshot.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RECEIPT_KEY = /^receipts\/(.+)\.(jpg|png|webp|pdf)$/;
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const ENUMS = {
  collections: { status: ["abierta", "cerrada", "archivada"] },
  payments: { status: ["en_revision", "recibido", "observado", "pagado", "anulado"] },
  bank_movements: { source: ["deuna_email"], match_status: ["auto", "manual", "unmatched", "ignored"] },
};
const goodId = (v) => typeof v === "string" && ID.test(v) && !/^\.+$/.test(v);

/**
 * Every CHECK of the Cloud baseline (the four data tables) and the preflight rule that covers it. A test parses
 * migrations-cloud/0001_baseline.sql and fails if a CHECK appears there without an entry here (or the reverse).
 */
export const CLOUD_CHECKS = {
  "collections: slug = lower(slug)": "slug",
  "collections: deadline GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'": "dates",
  "collections: status IN ('abierta', 'cerrada', 'archivada')": "enums",
  "collections: max_per_payment >= 1": "ranges",
  "collections: deuna_link_expires IS NULL OR deuna_link_expires GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'": "dates",
  "payments: amount_cents >= 0": "cents",
  "payments: expected_cents >= 0": "cents",
  "payments: transfer_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'": "dates",
  "payments: status IN ('en_revision', 'recibido', 'observado', 'pagado', 'anulado')": "enums",
  "students: option_cents >= 0": "cents",
  "bank_movements: source IN ('deuna_email')": "enums",
  "bank_movements: amount_cents >= 0": "cents",
  "bank_movements: match_status IN ('auto', 'manual', 'unmatched', 'ignored')": "enums",
};
export const PREFLIGHT_RULES = ["foreign_keys", "payments_collection", "students_payment", "movements_payment", "cents", "ranges", "ids", "enums", "slug", "dates", "json", "receipt_key", "text"];
const goodDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const badCents = (col) => `(typeof(${col}) <> 'integer' OR ${col} < 0 OR ${col} > ${MAX_CENTS})`;
const count = (db, sql) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get().n);

/**
 * Returns { ok, counts, failures: [{ check, count }] }. A failed run must not generate any SQL.
 * `tables` is the raw export: SQLite would silently cut a NUL or replace a lone surrogate, so text is checked before it is loaded.
 */
export function runPreflight(db, tables) {
  // Integers are read as BigInt so an unsafe value (above 2^53) is counted by the checks below instead of throwing here.
  const all = (table) => {
    const statement = db.prepare(`SELECT * FROM ${table}`);
    statement.setReadBigInts(true);
    return statement.all();
  };
  const collections = all("collections");
  const payments = all("payments");
  const dateCount = [...collections.flatMap((c) => [c.deadline, c.deuna_link_expires].filter((v) => v !== null)), ...payments.map((p) => p.transfer_date)].filter((v) => !goodDate(v)).length;
  const badText = TABLES.flatMap((t) => tables[t]).flatMap((row) => Object.values(row)).filter((v) => typeof v === "string" && (v.includes("\u0000") || !v.isWellFormed())).length;
  const movements = all("bank_movements");
  const intRange = (col, min) => `(typeof(${col}) <> 'integer' OR ${col} < ${min} OR ${col} > ${MAX_CENTS})`;
  const checks = {
    foreign_keys: db.prepare("PRAGMA foreign_key_check").all().length,
    payments_collection: count(db, "payments p WHERE p.collection_id IS NULL OR NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = p.collection_id)"),
    students_payment: count(db, "students s WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = s.payment_id)"),
    movements_payment: count(db, "bank_movements m WHERE m.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = m.payment_id)"),
    cents: count(db, `payments WHERE ${badCents("amount_cents")} OR ${badCents("expected_cents")}`) + count(db, `students WHERE ${badCents("option_cents")}`) + count(db, `bank_movements WHERE ${badCents("amount_cents")}`),
    ranges: count(db, `payments WHERE ${intRange("receipt_size", 0)}`) + count(db, `collections WHERE ${intRange("max_per_payment", 1)}`) + count(db, `students WHERE ${intRange("id", 1)}`)
      + count(db, `bank_movements WHERE match_score IS NOT NULL AND (typeof(match_score) NOT IN ('real', 'integer') OR abs(match_score) > ${MAX_CENTS})`),
    ids: [...collections, ...payments, ...movements].filter((row) => !goodId(row.id)).length,
    enums: Object.entries(ENUMS).flatMap(([table, cols]) => all(table).flatMap((row) => Object.entries(cols).filter(([col, allowed]) => !allowed.includes(row[col])))).length,
    slug: collections.filter((c) => !SLUG.test(c.slug)).length,
    dates: dateCount,
    json: count(db, "collections WHERE NOT json_valid(notes_json) OR NOT json_valid(options_json)"),
    receipt_key: payments.filter((p) => RECEIPT_KEY.exec(p.receipt_key)?.[1] !== p.id || !isRelativeKey(p.receipt_key)).length,
    text: badText,
  };
  const failures = Object.entries(checks).filter(([, n]) => n > 0).map(([check, n]) => ({ check, count: n }));
  return { ok: failures.length === 0, counts: Object.fromEntries(TABLES.map((t) => [t, count(db, t)])), failures };
}

const TARGET_TABLES = TABLES;

/**
 * state = { tenant: { id, slug, source } | null, rows: { <table>: n }, collidingIds: n }.
 * Passes only for an existing pilot_import tenant with the expected id and slug, zero rows and no id collision anywhere.
 */
export function evaluateTarget(state, { slug, tenantId }) {
  const failures = [];
  const t = state?.tenant;
  if (!t || typeof t !== "object") failures.push("tenant_missing");
  else {
    if (t.source !== "pilot_import") failures.push("tenant_source");
    if (t.slug !== slug || t.id !== tenantId) failures.push("tenant_identity");
  }
  const rows = state?.rows;
  if (!rows || !TARGET_TABLES.every((table) => Number.isSafeInteger(rows[table]))) failures.push("rows_unreadable");
  else if (TARGET_TABLES.some((table) => rows[table] !== 0)) failures.push("rows_not_empty");
  if (!Number.isSafeInteger(state?.collidingIds)) failures.push("collisions_unreadable");
  else if (state.collidingIds !== 0) failures.push("id_collisions");
  return { ok: failures.length === 0, failures };
}
