import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createCloudTestDb } from "../../../src/worker/test/d1-cloud";
import { TENANT_ID, makeTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { canonicalDigest } from "./canonical.mjs";
// @ts-expect-error plain .mjs module without types
import { insertStatements, buildImportSql } from "./chunk.mjs";
// @ts-expect-error plain .mjs module without types
import { loadSnapshot } from "./pilot-snapshot.mjs";
// @ts-expect-error plain .mjs module without types
import { transform } from "./transform.mjs";

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const rowsOf = (n: number, text: string) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, body: text }));

describe("insertStatements", () => {
  it("splits 2,000 long-text rows into statements of at most 100 rows and 90,000 bytes", () => {
    const rows = rowsOf(2000, "ñ".repeat(900));
    const statements: string[] = insertStatements("t", ["id", "body"], rows);
    expect(statements.length).toBeGreaterThan(20);
    for (const sql of statements) {
      expect(bytes(sql)).toBeLessThanOrEqual(90_000);
      expect((sql.match(/\n\(/g) ?? []).length).toBeLessThanOrEqual(100);
    }
    expect(statements.join("").match(/'r\d+'/g)).toHaveLength(2000);
  });

  it("keeps rows in order and starts every statement with an INSERT for the table", () => {
    const statements: string[] = insertStatements("t", ["id", "body"], rowsOf(250, "x"));
    expect(statements).toHaveLength(3);
    expect(statements.every((s) => s.startsWith("INSERT INTO t (id, body) VALUES\n"))).toBe(true);
    expect(statements[1]).toContain("'r100'");
  });

  it("fails when one row alone does not fit, and emits nothing for no rows", () => {
    expect(() => insertStatements("t", ["id", "body"], rowsOf(1, "x".repeat(91_000)))).toThrow();
    expect(insertStatements("t", ["id", "body"], [])).toEqual([]);
  });
});

describe("buildImportSql", () => {
  const out = () => transform(loadSnapshot(makeTables()), { tenantId: TENANT_ID });

  it("inserts in foreign-key order, with no PRAGMA, no transaction statements and no comments", () => {
    const sql: string = buildImportSql(out()).join("\n");
    const order = ["collections", "payments", "students", "bank_movements"].map((t) => sql.indexOf(`INSERT INTO ${t} `));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql).not.toMatch(/PRAGMA|BEGIN|COMMIT|--|\/\*/i);
  });

  it("applies to the Cloud baseline and reads back the same canonical digests", () => {
    const db = createCloudTestDb();
    const now = "2026-11-27T00:00:00Z";
    db.sqlite.exec(`INSERT INTO tenants (id, slug, config_json, r2_prefix, source, created_at, updated_at) VALUES ('${TENANT_ID}', 'curso-demo', '{}', 't/${TENANT_ID}/', 'pilot_import', '${now}', '${now}')`);
    const expected = out();
    db.sqlite.exec(buildImportSql(expected).join("\n"));
    for (const table of ["collections", "payments", "students", "bank_movements"]) {
      const orderBy = table === "students" ? "id" : "id";
      const back = (db.sqlite as DatabaseSync).prepare(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY id`).all(TENANT_ID);
      expect(canonicalDigest(table, back), table).toBe(canonicalDigest(table, expected[table]));
    }
    const ids = (db.sqlite as DatabaseSync).prepare("SELECT given_names FROM students ORDER BY id").all().map((r: any) => r.given_names);
    expect(ids).toEqual(["Alumno 3", "Alumno 7", "Alumno 9"]);
  });
});
