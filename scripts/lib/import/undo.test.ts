import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OTHER, SLUG, makePilotWorld, NOW } from "./pilot-world";
import { TENANT_ID } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { runUndo, undoStatements } from "./undo.mjs";

const OWNER = "u-owner-demo";
const SHARED = "u-shared-demo";

function imported(opts: Parameters<typeof makePilotWorld>[0] = {}) {
  const w = makePilotWorld(opts);
  const sql = w.cloud.sqlite;
  sql.exec(`INSERT INTO users (id, email, created_at) VALUES ('${OWNER}', 'owner@example.net', '${NOW}'), ('${SHARED}', 'shared@example.net', '${NOW}')`);
  if (opts.tenant !== null) {
    sql.exec(readFileSync(join(w.dir, "import.sql"), "utf8"));
  sql.exec(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ('${TENANT_ID}', '${OWNER}', 'owner', '${NOW}'), ('${TENANT_ID}', '${SHARED}', 'co_treasurer', '${NOW}')`);
  sql.exec(`INSERT INTO sessions (token_hash, tenant_id, user_id, created_at, expires_at) VALUES ('s1', '${TENANT_ID}', '${OWNER}', '${NOW}', '2027-01-01T00:00:00Z')`);
  sql.exec(`INSERT INTO magic_links (token_hash, tenant_id, email, created_at, expires_at) VALUES ('m1', '${TENANT_ID}', 'owner@example.net', '${NOW}', '2027-01-01T00:00:00Z')`);
  sql.exec(`INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES ('${SLUG}.colegio-demo.example.test', '${TENANT_ID}', 'subdomain', '${NOW}')`);
  }
  // A second tenant that must never be touched, with data and a membership of the shared user.
  w.addTenant(OTHER, "otro-curso", "cloud");
  w.addCollection(OTHER, "other-col", "otro-demo");
  sql.exec(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ('${OTHER}', '${SHARED}', 'co_treasurer', '${NOW}')`);
  const statements: string[] = [];
  const remote = {
    select: (q: string) => sql.prepare(q).all(),
    mutate: (q: string) => { statements.push(q); sql.exec(q); },
  };
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const undo = (tenantLevel: boolean, over: Record<string, unknown> = {}) => runUndo({ tenantId: TENANT_ID, slug: SLUG, tenantLevel, ...over }, { remote, log }) as number;
  const rows = (table: string, tenant: string) => (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = '${tenant}'`).get() as { n: number }).n;
  return { ...w, statements, remote, out, undo, rows };
}
const DATA = ["collections", "payments", "students", "bank_movements"];

describe("undo-data", () => {
  it("leaves zero rows for the tenant, keeps another tenant and the tenant itself", () => {
    const w = imported();
    expect(w.undo(false)).toBe(0);
    for (const table of DATA) expect(w.rows(table, TENANT_ID)).toBe(0);
    expect(w.rows("collections", OTHER)).toBe(1);
    expect(w.rows("memberships", TENANT_ID)).toBe(2);
    expect(w.rows("tenant_domains", TENANT_ID)).toBe(1);
  });

  it("deletes in reverse foreign-key order, only with the tenant id and the pilot_import guard", () => {
    const w = imported();
    w.undo(false);
    expect(w.statements.map((s) => /^DELETE FROM (\w+)/.exec(s)![1])).toEqual(["bank_movements", "students", "payments", "collections"]);
    for (const s of w.statements) {
      expect(s).toContain(`tenant_id = '${TENANT_ID}'`);
      expect(s).toContain(`EXISTS (SELECT 1 FROM tenants WHERE id = '${TENANT_ID}' AND source = 'pilot_import')`);
      expect(s).not.toContain(OTHER);
    }
  });

  it("the EXISTS guard stops the statements on a tenant that is not pilot_import", () => {
    const w = imported({ tenant: { slug: SLUG, source: "cloud" } });
    for (const s of undoStatements(TENANT_ID, { tenant: true, ownerIds: [OWNER] })) w.cloud.sqlite.exec(s);
    for (const table of DATA) expect(w.rows(table, TENANT_ID)).toBeGreaterThan(0);
    expect(w.rows("tenant_domains", TENANT_ID)).toBe(1);
    expect(w.rows("memberships", TENANT_ID)).toBe(2);
  });

  it.each([
    ["the tenant does not exist", { tenant: null }],
    ["the tenant is not pilot_import", { tenant: { slug: SLUG, source: "cloud" } }],
    ["the slug differs", { tenant: { slug: "otro-demo", source: "pilot_import" } }],
  ])("refuses and deletes nothing when %s", (_n, opts) => {
    const w = imported(opts);
    expect(w.undo(false)).toBe(1);
    expect(w.statements).toEqual([]);
  });

  it("refuses ids that are not a UUID or slug without building SQL", () => {
    const w = imported();
    expect(w.undo(false, { tenantId: "x' OR 1=1 --" })).toBe(1);
    expect(w.undo(false, { slug: "Bad Slug" })).toBe(1);
    expect(w.statements).toEqual([]);
  });

  it("reports a failure generically and never claims success when rows remain", () => {
    const w = imported();
    w.remote.mutate = () => { throw new Error("SQLITE Familia"); };
    expect(w.undo(false)).toBe(1);
    expect(w.out.join("\n")).not.toMatch(/SQLITE|Familia/);
    expect(w.out.join("\n")).not.toContain("OK");
  });
});

describe("undo-tenant", () => {
  it("removes the tenant scoped rows and the tenant, keeps the other tenant and a user with another membership", () => {
    const w = imported();
    expect(w.undo(true)).toBe(0);
    for (const table of [...DATA, "sessions", "magic_links", "memberships", "tenant_domains"]) expect(w.rows(table, TENANT_ID)).toBe(0);
    const count = (q: string) => (w.cloud.sqlite.prepare(q).get() as { n: number }).n;
    expect(count(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM users WHERE id = '${SHARED}'`)).toBe(1);
    expect(w.rows("collections", OTHER)).toBe(1);
    expect(w.rows("memberships", OTHER)).toBe(1);
  });

  it("keeps the owner user when the owner has another membership", () => {
    const w = imported();
    w.cloud.sqlite.exec(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ('${OTHER}', '${OWNER}', 'co_treasurer', '${NOW}')`);
    expect(w.undo(true)).toBe(0);
    expect((w.cloud.sqlite.prepare(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`).get() as { n: number }).n).toBe(1);
  });

  it("only ever names the target tenant, and deletes the tenant row last", () => {
    const w = imported();
    w.undo(true);
    expect(w.statements.map((s) => /^DELETE FROM (\w+)/.exec(s)![1])).toEqual(["bank_movements", "students", "payments", "collections", "sessions", "magic_links", "memberships", "users", "tenant_domains", "tenants"]);
    for (const s of w.statements) expect(s).not.toContain(OTHER);
    expect(w.statements.at(-1)).toBe(`DELETE FROM tenants WHERE id = '${TENANT_ID}' AND source = 'pilot_import';`);
  });

  it("refuses an owner id that is not a plain id", () => {
    expect(() => undoStatements(TENANT_ID, { tenant: true, ownerIds: ["x'; DROP TABLE tenants; --"] })).toThrow();
  });
});
