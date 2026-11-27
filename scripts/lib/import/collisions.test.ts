import { describe, expect, it } from "vitest";
import { createCloudTestDb } from "../../../src/worker/test/d1-cloud";
import { TENANT_ID, makeTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { buildImportSql } from "./chunk.mjs";
// @ts-expect-error plain .mjs module without types
import { COLLISION_TABLES, collisionIds, collisionQueries } from "./collisions.mjs";
// @ts-expect-error plain .mjs module without types
import { loadSnapshot } from "./pilot-snapshot.mjs";
// @ts-expect-error plain .mjs module without types
import { transform } from "./transform.mjs";

const plan = () => transform(loadSnapshot(makeTables()), { tenantId: TENANT_ID });
const OTHER = "d0000000-0000-4000-8000-0000000000d1";

describe("global primary keys the apply step must check", () => {
  it("lists exactly the ids of collections, payments and movements (students ids are generated)", () => {
    expect(COLLISION_TABLES).toEqual(["collections", "payments", "bank_movements"]);
    expect(collisionIds(plan())).toEqual({ collections: ["col-1", "col-2"], payments: ["pay-1", "pay-2", "pay-3"], bank_movements: ["mov-1", "mov-2"] });
  });

  it("builds only SELECT statements, each under 90,000 bytes, even for thousands of ids", () => {
    const big = { collections: [], payments: Array.from({ length: 5000 }, (_, i) => ({ id: `payment-${i}`.padEnd(60, "x") })), bank_movements: [] };
    const queries: string[] = collisionQueries(big);
    expect(queries.length).toBeGreaterThan(1);
    for (const q of queries) {
      expect(q.startsWith("SELECT COUNT(*) AS n FROM payments WHERE id IN (")).toBe(true);
      expect(Buffer.byteLength(q)).toBeLessThanOrEqual(90_000);
      expect(q).not.toMatch(/INSERT|UPDATE|DELETE|DROP|PRAGMA/i);
    }
  });

  it("counts the plan's ids that another tenant already owns", () => {
    const db = createCloudTestDb();
    const now = "2026-11-27T00:00:00Z";
    for (const [id, slug] of [[TENANT_ID, "curso-demo"], [OTHER, "otro-demo"]]) {
      db.sqlite.exec(`INSERT INTO tenants (id, slug, config_json, r2_prefix, source, created_at, updated_at) VALUES ('${id}', '${slug}', '{}', 't/${id}/', 'pilot_import', '${now}', '${now}')`);
    }
    const queries: string[] = collisionQueries(plan());
    const total = () => queries.reduce((sum, q) => sum + Number((db.sqlite as any).prepare(q).get().n), 0);
    expect(total()).toBe(0);
    const moved = plan();
    // The same plan imported under ANOTHER tenant: its ids now collide with the plan for TENANT_ID.
    db.sqlite.exec(buildImportSql(transform(loadSnapshot(makeTables()), { tenantId: OTHER })).join("\n"));
    expect(total()).toBe(moved.collections.length + moved.payments.length + moved.bank_movements.length);
  });
});
