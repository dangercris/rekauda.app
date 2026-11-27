// Loads the pilot export into a local in-memory node:sqlite database built from the pilot migrations (0001-0005), so the
// preflight and the transform can run real SQL over the data. Nothing is written to disk and nothing is printed.
// Errors are generic on purpose: they never carry row content. No dependencies.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../../migrations/", import.meta.url));
export const TABLES = ["collections", "payments", "students", "bank_movements"];
const MIN_NODE = [22, 18];

/** Type stripping and an unflagged node:sqlite need Node 22.18 or newer. Fails closed on anything unreadable. */
export function assertNodeVersion(version = process.versions.node) {
  const [major, minor] = String(version).split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    throw new Error(`Node ${MIN_NODE.join(".")} or newer is required`);
  }
}

// Whole numbers go in as integers (a plain JS number above 32 bits would be bound as a REAL and look "unsafe").
const bind = (value) => (typeof value === "number" && Number.isInteger(value) ? BigInt(value) : value);

/** `tables` is { collections, payments, students, bank_movements }, each an array of row objects. Returns a DatabaseSync. */
export function loadSnapshot(tables) {
  assertNodeVersion();

  const db = new DatabaseSync(":memory:");
  try {
    // Foreign keys stay OFF while loading: the preflight reports violations instead of failing on the first one.
    db.exec("PRAGMA foreign_keys = OFF");
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    for (const table of TABLES) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const row of tables[table]) {
        const keys = Object.keys(row);
        if (keys.length === 0 || !keys.every((k) => columns.has(k))) throw new Error("x");
        db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => bind(row[k])));
      }
    }
  } catch {
    db.close();
    throw new Error("the snapshot does not fit the pilot schema");
  }
  return db;
}
