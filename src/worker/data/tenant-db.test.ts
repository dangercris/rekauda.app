import { describe, expect, it } from "vitest";
import { TENANT_A, TENANT_B, createCloudTestDb } from "../test/d1-cloud";
import { asD1 } from "../test/d1";
import { TenantDb, TenantScopeViolation } from "./tenant-db";

function scoped(tenantId: string) {
  const raw = createCloudTestDb({ seed: true });
  return { raw, db: new TenantDb(asD1(raw), tenantId) };
}

describe("TenantDb.prepare", () => {
  it.each([
    ["no tenant_id", "SELECT id FROM collections WHERE id = ?1"],
    ["no ?1", "SELECT id FROM collections WHERE tenant_id = ?2"],
    ["a bare ?", "SELECT id FROM collections WHERE tenant_id = ?1 AND slug = ?"],
    ["a named parameter", "SELECT id FROM collections WHERE tenant_id = ?1 AND slug = :slug"],
    ["tenant_id only inside a string literal", "SELECT id FROM collections WHERE slug = 'tenant_id ?1'"],
    ["tenant_id only inside a comment", "SELECT id FROM collections -- tenant_id = ?1\n WHERE id = ?2"],
    ["a block comment", "SELECT id FROM collections /* tenant_id = ?1 */ WHERE id = ?2"],
    ["an unterminated string literal", "SELECT id FROM collections WHERE tenant_id = ?1 AND slug = 'x"],
    ["a second statement", "SELECT id FROM collections WHERE tenant_id = ?1; DELETE FROM payments WHERE id = ?2"],
  ])("throws TenantScopeViolation for %s", (_name, sql) => {
    const { db } = scoped(TENANT_A);
    expect(() => db.prepare(sql)).toThrow(TenantScopeViolation);
  });

  it("accepts scoped SQL, including a trailing semicolon and a bare ? inside a literal", () => {
    const { db } = scoped(TENANT_A);
    expect(() => db.prepare("SELECT id FROM collections WHERE tenant_id = ?1 AND slug = ?2;")).not.toThrow();
    expect(() => db.prepare("SELECT '?' AS q FROM collections WHERE tenant_id = ?1")).not.toThrow();
  });
});

describe("TenantDb.bind", () => {
  it("binds the tenant id as ?1 so only that tenant's rows are visible", async () => {
    const a = scoped(TENANT_A);
    const b = scoped(TENANT_B);
    const sql = "SELECT slug, title FROM collections WHERE tenant_id = ?1 AND slug = ?2";
    expect(await a.db.prepare(sql).bind("demo-collection").first()).toEqual({ slug: "demo-collection", title: "Demo collection A" });
    expect(await b.db.prepare(sql).bind("demo-collection").first()).toEqual({ slug: "demo-collection", title: "Demo collection B" });
  });

  it("works with only ?1", async () => {
    const { db } = scoped(TENANT_B);
    const { results } = await db.prepare("SELECT title FROM collections WHERE tenant_id = ?1").bind().all<{ title: string }>();
    expect(results).toEqual([{ title: "Demo collection B" }]);
  });

  it("never lets a caller replace ?1 (the caller's first value is ?2)", async () => {
    const { db } = scoped(TENANT_A);
    const row = await db.prepare("SELECT title FROM collections WHERE tenant_id = ?1 AND id = ?2").bind("c0000000-0000-4000-8000-00000000000b").first();
    expect(row).toBeNull();
  });

  it("throws when the number of values does not match the numbered parameters", () => {
    const { db } = scoped(TENANT_A);
    const stmt = db.prepare("SELECT id FROM collections WHERE tenant_id = ?1 AND slug = ?2");
    expect(() => stmt.bind()).toThrow(TenantScopeViolation);
    expect(() => stmt.bind("a", "b")).toThrow(TenantScopeViolation);
    expect(() => stmt.bind("a")).not.toThrow();
  });
});

describe("TenantDb.batch", () => {
  it("runs scoped statements atomically", async () => {
    const { db, raw } = scoped(TENANT_A);
    const upd = db.prepare("UPDATE collections SET title = ?2 WHERE tenant_id = ?1 AND slug = ?3");
    const results = await db.batch([upd.bind("Renamed", "demo-collection"), upd.bind("Second", "demo-collection")]);
    expect(results.map((r) => r.meta.changes)).toEqual([1, 1]);
    expect(raw.sqlite.prepare("SELECT title FROM collections WHERE tenant_id = ?").get(TENANT_A)).toEqual({ title: "Second" });
    expect(raw.sqlite.prepare("SELECT title FROM collections WHERE tenant_id = ?").get(TENANT_B)).toEqual({ title: "Demo collection B" });
  });

  it("rolls back the whole batch when one statement fails", async () => {
    const { db, raw } = scoped(TENANT_A);
    const upd = db.prepare("UPDATE collections SET title = ?2 WHERE tenant_id = ?1 AND slug = ?3");
    const bad = db.prepare("UPDATE collections SET status = ?2 WHERE tenant_id = ?1 AND slug = ?3");
    await expect(db.batch([upd.bind("Changed", "demo-collection"), bad.bind("not-a-status", "demo-collection")])).rejects.toThrow();
    expect(raw.sqlite.prepare("SELECT title FROM collections WHERE tenant_id = ?").get(TENANT_A)).toEqual({ title: "Demo collection A" });
  });
});

describe("opaque bound statements", () => {
  it("returns a wrapper that exposes only run, all, first and raw", async () => {
    const { db } = scoped(TENANT_A);
    const bound = db.prepare("SELECT slug FROM collections WHERE tenant_id = ?1").bind();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(bound)).sort()).toEqual(["all", "constructor", "first", "raw", "run"]);
    expect("bind" in bound).toBe(false);
    expect(await bound.first()).toEqual({ slug: "demo-collection" });
  });

  it("refuses statements that did not come from TenantDb", async () => {
    const { db, raw } = scoped(TENANT_A);
    const foreign = asD1(raw).prepare("DELETE FROM payments").bind();
    await expect(db.batch([foreign as never])).rejects.toThrow(TenantScopeViolation);
    const other = scoped(TENANT_B).db.prepare("DELETE FROM payments WHERE tenant_id = ?1").bind();
    await expect(db.batch([other])).rejects.toThrow(TenantScopeViolation);
  });
});

describe("runtime encapsulation", () => {
  it("hides the raw database and cannot be switched to another tenant", () => {
    const { db } = scoped(TENANT_A);
    expect(Object.keys(db)).toEqual([]);
    expect((db as unknown as { db?: unknown }).db).toBeUndefined();
    expect(Object.isFrozen(db)).toBe(true);
    expect(() => {
      (db as unknown as { tenantId: string }).tenantId = TENANT_B;
    }).toThrow(TypeError);
    expect(db.tenantId).toBe(TENANT_A);
  });

  it("freezes prepared and bound statements and hides their raw statement", () => {
    const { db } = scoped(TENANT_A);
    const prepared = db.prepare("SELECT slug FROM collections WHERE tenant_id = ?1");
    const bound = prepared.bind();
    for (const obj of [prepared, bound]) {
      expect(Object.isFrozen(obj)).toBe(true);
      expect(Object.keys(obj)).toEqual([]);
    }
    expect(() => {
      (prepared as unknown as { tenantId: string }).tenantId = TENANT_B;
    }).toThrow(TypeError);
  });

  it("rejects forged bound statements in batch", async () => {
    const { db, raw } = scoped(TENANT_A);
    const bound = db.prepare("SELECT slug FROM collections WHERE tenant_id = ?1").bind();
    const Ctor = Object.getPrototypeOf(bound).constructor as new (...args: unknown[]) => never;
    const rawStatement = asD1(raw).prepare("DELETE FROM payments").bind();
    expect(() => new Ctor(rawStatement, TENANT_A)).toThrow(TenantScopeViolation);
    const lookalike = Object.create(Object.getPrototypeOf(bound)) as never;
    await expect(db.batch([lookalike])).rejects.toThrow(TenantScopeViolation);
  });
});
