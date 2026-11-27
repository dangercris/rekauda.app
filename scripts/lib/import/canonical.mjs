// Canonical form of imported rows, used for validation: ONE function digests both the expected rows (from the local
// snapshot) and the Cloud read-back, so they cannot drift apart. tenant_id and students.id are excluded (they differ by
// design), the order of the rows is part of the digest, and so is the table name. A missing column throws: a read-back
// that lacks a column must fail validation, never hash as null. No dependencies.
import { hash } from "node:crypto";
import { IMPORT_COLUMNS } from "./columns.mjs";

export function canonicalDigest(table, rows) {
  const columns = IMPORT_COLUMNS[table].filter((c) => c !== "tenant_id");
  const body = rows.map((row) => columns.map((c) => {
    if (!(c in row)) throw new Error("a row is missing a column");
    return row[c];
  }));
  return hash("sha256", JSON.stringify([table, body]), "hex");
}
