// Chunked literal INSERT statements. D1 refuses statements over 100 KB, so each one stays under 90,000 UTF-8 bytes and
// 100 rows. No comments, no PRAGMA and no transaction statements are ever emitted: the file is plain INSERTs in
// foreign-key order. No dependencies.
import { IMPORT_COLUMNS, IMPORT_TABLES } from "./columns.mjs";
import { literal } from "./sql-literal.mjs";

export const MAX_ROWS = 100;
export const MAX_BYTES = 90_000;
const bytes = (text) => Buffer.byteLength(text, "utf8");

export function insertStatements(table, columns, rows) {
  const head = `INSERT INTO ${table} (${columns.join(", ")}) VALUES`;
  const statements = [];
  let tuples = [];
  let size = 0;
  const flush = () => {
    if (tuples.length > 0) statements.push(`${head}\n${tuples.join(",\n")};`);
    tuples = [];
    size = 0;
  };
  for (const row of rows) {
    const tuple = `(${columns.map((c) => literal(row[c] ?? null)).join(", ")})`;
    // head + newline + tuples joined by ",\n" + ";" : each tuple costs its length plus 2 bytes of separator.
    const cost = bytes(tuple) + 2;
    if (bytes(head) + 2 + cost > MAX_BYTES) throw new Error("one row does not fit in a statement");
    if (tuples.length >= MAX_ROWS || bytes(head) + 2 + size + cost > MAX_BYTES) flush();
    tuples.push(tuple);
    size += cost;
  }
  flush();
  return statements;
}

/** All statements for the four tables, in foreign-key order. */
export const buildImportSql = (tables) => IMPORT_TABLES.flatMap((table) => insertStatements(table, IMPORT_COLUMNS[table], tables[table]));
