import { describe, expect, it } from "vitest";
import { TenantDb } from "../data/tenant-db";
import { asD1 } from "./d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./d1-cloud";
import { spyOnDb } from "./sql-spy";

describe("spyOnDb", () => {
  it("records statements issued through TenantDb and passes when all are scoped", async () => {
    const spy = spyOnDb(createCloudTestDb({ seed: true }));
    const db = new TenantDb(asD1(spy.db), TENANT_A);
    await db.prepare("SELECT title FROM collections WHERE tenant_id = ?1 AND slug = ?2").bind("demo-collection").first();
    await db.batch([db.prepare("UPDATE collections SET title = ?2 WHERE tenant_id = ?1 AND slug = ?3").bind("Renamed", "demo-collection")]);
    expect(spy.statements.map((s) => s.params)).toEqual([[TENANT_A, "demo-collection"], [TENANT_A, "Renamed", "demo-collection"]]);
    expect(() => spy.assertAllScoped(TENANT_A)).not.toThrow();
  });

  it("fails when a statement is bound to another tenant", async () => {
    const spy = spyOnDb(createCloudTestDb({ seed: true }));
    await new TenantDb(asD1(spy.db), TENANT_B).prepare("SELECT title FROM collections WHERE tenant_id = ?1").bind().first();
    expect(() => spy.assertAllScoped(TENANT_A)).toThrow(/bound to/);
  });

  it("fails on a statement that bypasses TenantDb and ignores the tenant", async () => {
    const spy = spyOnDb(createCloudTestDb({ seed: true }));
    await spy.db.prepare("SELECT s.id FROM payments p JOIN students s ON s.payment_id = p.id WHERE p.tenant_id = ?1").bind(TENANT_A).all();
    expect(() => spy.assertAllScoped(TENANT_A)).toThrow(/alias s/);
  });

  it("fails on a statement executed without any bind", async () => {
    const spy = spyOnDb(createCloudTestDb({ seed: true }));
    await spy.db.prepare("SELECT id FROM collections").all();
    expect(() => spy.assertAllScoped(TENANT_A)).toThrow(/tenant/i);
  });

  it("records statements executed through batch and flags a foreign tenant there", async () => {
    const spy = spyOnDb(createCloudTestDb({ seed: true }));
    const other = new TenantDb(asD1(spy.db), TENANT_B);
    await other.batch([other.prepare("UPDATE collections SET title = ?2 WHERE tenant_id = ?1 AND slug = ?3").bind("x", "demo-collection")]);
    expect(spy.statements).toHaveLength(1);
    expect(() => spy.assertAllScoped(TENANT_A)).toThrow(/another tenant/);
  });

  it("records only executed statements and does not expose the raw sqlite handle", async () => {
    const spy = spyOnDb(createCloudTestDb({ seed: true }));
    spy.db.prepare("SELECT 1 FROM collections WHERE tenant_id = ?1").bind(TENANT_A);
    expect(spy.statements).toHaveLength(0);
    expect("sqlite" in spy.db).toBe(false);
  });

  it("fails when nothing was recorded, so an unwired test cannot pass vacuously", () => {
    expect(() => spyOnDb(createCloudTestDb()).assertAllScoped(TENANT_A)).toThrow(/no statements/);
  });
});
