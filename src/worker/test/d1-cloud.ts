/// <reference types="node" />
/**
 * Test double for the Cloud (multi-tenant) schema: node:sqlite with migrations-cloud applied and foreign keys ON
 * (D1 always enforces them, so the double must too).
 */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { wrapSqlite, type TestDb } from "./d1";

const MIGRATIONS = new URL("../../../migrations-cloud/", import.meta.url);
const SEED = new URL("../../../scripts/cloud-seed.local.sql", import.meta.url);

/** Fictional tenants created by scripts/cloud-seed.local.sql. */
export const TENANT_A = "a0000000-0000-4000-8000-00000000000a";
export const TENANT_B = "b0000000-0000-4000-8000-00000000000b";

export function createCloudTestDb(options: { seed?: boolean } = {}): TestDb {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  if (options.seed) sqlite.exec(readFileSync(SEED, "utf8"));
  return wrapSqlite(sqlite);
}

/** Applies the local seed (tenants demo-a and demo-b). Safe to call repeatedly. */
export function seedTenants(db: TestDb): void {
  db.sqlite.exec(readFileSync(SEED, "utf8"));
}
