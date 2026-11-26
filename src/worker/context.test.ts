import { describe, expect, it } from "vitest";
import { TenantScopeViolation } from "./data/tenant-db";
import { buildContext } from "./context";
import { TenantStorageViolation } from "./storage/tenant-storage";
import { asD1 } from "./test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./test/d1-cloud";
import { FakeBucket, asR2 } from "./test/r2-fake";
import { spyOnDb } from "./test/sql-spy";
import type { Tenant } from "./tenancy/tenant";

const tenant = (id: string, slug: string): Tenant => ({ id, slug, r2Prefix: `t/${id}/`, source: "cloud" });

function setup() {
  const spy = spyOnDb(createCloudTestDb({ seed: true }));
  const bucket = new FakeBucket();
  const bindings = { db: asD1(spy.db), files: asR2(bucket) };
  return { spy, bucket, a: buildContext(tenant(TENANT_A, "demo-a"), bindings), b: buildContext(tenant(TENANT_B, "demo-b"), bindings) };
}

describe("buildContext", () => {
  it("exposes only the tenant, a tenant-bound db and a tenant-bound storage", () => {
    const { a } = setup();
    expect(Object.keys(a).sort()).toEqual(["db", "storage", "tenant"]);
    expect(a.tenant.id).toBe(TENANT_A);
    expect(a.db.tenantId).toBe(TENANT_A);
  });

  it("scopes data access to the tenant of the context", async () => {
    const { a, b, spy } = setup();
    const sql = "SELECT title FROM collections WHERE tenant_id = ?1";
    expect(await a.db.prepare(sql).bind().first()).toEqual({ title: "Demo collection A" });
    expect(await b.db.prepare(sql).bind().first()).toEqual({ title: "Demo collection B" });
    expect(() => spy.assertAllScoped(TENANT_A)).toThrow(/another tenant/);
    expect(spy.statements.map((s) => s.params[0])).toEqual([TENANT_A, TENANT_B]);
  });

  it("refuses unscoped SQL on the context db", () => {
    expect(() => setup().a.db.prepare("SELECT title FROM collections")).toThrow(TenantScopeViolation);
  });

  it("scopes storage to the tenant of the context", async () => {
    const { a, b, bucket } = setup();
    const key = await a.storage.put("receipts/p1.png", "a");
    expect(key).toBe(`t/${TENANT_A}/receipts/p1.png`);
    await expect(b.storage.get(key)).rejects.toThrow(TenantStorageViolation);
    expect(bucket.reads).toEqual([]);
  });
});
