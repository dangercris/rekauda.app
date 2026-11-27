// Canonical form of imported rows, used for validation: ONE function digests both the expected rows (from the local
// snapshot) and the Cloud read-back, so they cannot drift apart. tenant_id and students.id are excluded (they differ by
// design), and the order of the rows is part of the digest. No dependencies.
import { hash } from "node:crypto";
import { IMPORT_COLUMNS } from "./columns.mjs";

export function canonicalDigest(table, rows) {
  const columns = IMPORT_COLUMNS[table].filter((c) => c !== "tenant_id");
  return hash("sha256", JSON.stringify(rows.map((row) => columns.map((c) => row[c] ?? null))), "hex");
}
