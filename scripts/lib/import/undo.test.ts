import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOW, OTHER, SLUG, makePilotWorld } from "./pilot-world";
import { TENANT_ID } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { readManifest, writeManifest } from "../private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { runUndo, undoStatements } from "./undo.mjs";

const OWNER = "u-owner-demo";
const SOLE = "u-cotreasurer-demo";
const SHARED = "u-shared-demo";
const FULL_GUARD = `EXISTS (SELECT 1 FROM tenants WHERE id = '${TENANT_ID}' AND source = 'pilot_import')`;

function imported(opts: Parameters<typeof makePilotWorld>[0] = {}) {
  const w = makePilotWorld(opts);
  const sql = w.cloud.sqlite;
  sql.exec(`INSERT INTO users (id, email, created_at) VALUES ('${OWNER}', 'owner@example.net', '${NOW}'), ('${SOLE}', 'cot@example.net', '${NOW}'), ('${SHARED}', 'shared@example.net', '${NOW}')`);
  if (opts.tenant !== null) {
    if (opts.plan !== false) sql.exec(readFileSync(join(w.dir, "import.sql"), "utf8"));
    sql.exec(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ('${TENANT_ID}', '${OWNER}', 'owner', '${NOW}'), ('${TENANT_ID}', '${SOLE}', 'co_treasurer', '${NOW}'), ('${TENANT_ID}', '${SHARED}', 'co_treasurer', '${NOW}')`);
    sql.exec(`INSERT INTO sessions (token_hash, tenant_id, user_id, created_at, expires_at) VALUES ('s1', '${TENANT_ID}', '${OWNER}', '${NOW}', '2027-01-01T00:00:00Z')`);
    sql.exec(`INSERT INTO magic_links (token_hash, tenant_id, email, created_at, expires_at) VALUES ('m1', '${TENANT_ID}', 'owner@example.net', '${NOW}', '2027-01-01T00:00:00Z')`);
    sql.exec(`INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES ('${SLUG}.colegio-demo.example.test', '${TENANT_ID}', 'subdomain', '${NOW}')`);
  }
  // A second tenant that must never be touched, with data and a membership of the shared user.
  w.addTenant(OTHER, "otro-curso", "cloud");
  w.addCollection(OTHER, "other-col", "otro-demo");
  sql.exec(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ('${OTHER}', '${SHARED}', 'co_treasurer', '${NOW}')`);
  const statements: string[] = [];
  const hooks: { afterMutate?: (n: number) => void; skip?: (q: string) => boolean } = {};
  const remote = {
    select: (q: string) => sql.prepare(q).all(),
    mutate: (q: string) => {
      statements.push(q);
      if (!hooks.skip?.(q)) sql.exec(q);
      hooks.afterMutate?.(statements.length);
    },
  };
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const undo = (tenantLevel: boolean, over: Record<string, unknown> = {}) => runUndo({ dir: w.dir, manifest: readManifest(w.dir), tenantId: TENANT_ID, slug: SLUG, tenantLevel, ...over }, { remote, log }) as number;
  const rows = (table: string, tenant: string) => (sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = '${tenant}'`).get() as { n: number }).n;
  const one = (q: string) => (sql.prepare(q).get() as { n: number }).n;
  return { ...w, statements, hooks, remote, out, undo, rows, one };
}
const DATA = ["collections", "payments", "students", "bank_movements"];

describe("undo-data", () => {
  it("leaves zero rows for the tenant, keeps another tenant and the tenant itself", () => {
    const w = imported();
    expect(w.undo(false)).toBe(0);
    for (const table of DATA) expect(w.rows(table, TENANT_ID)).toBe(0);
    expect(w.rows("collections", OTHER)).toBe(1);
    expect(w.rows("memberships", TENANT_ID)).toBe(3);
    expect(w.rows("tenant_domains", TENANT_ID)).toBe(1);
  });

  it("deletes in reverse foreign-key order, only with the tenant id and the full pilot_import guard", () => {
    const w = imported();
    w.undo(false);
    expect(w.statements.map((s) => /^DELETE FROM (\w+)/.exec(s)![1])).toEqual(["bank_movements", "students", "payments", "collections"]);
    for (const s of w.statements) {
      expect(s).toContain(`tenant_id = '${TENANT_ID}'`);
      expect(s).toContain(FULL_GUARD);
      expect(s).not.toContain(OTHER);
    }
  });

  it("the EXISTS guard stops the statements on a tenant that is not pilot_import", () => {
    const w = imported({ tenant: { slug: SLUG, source: "cloud" } });
    for (const s of undoStatements(TENANT_ID, { tenant: true, userIds: [OWNER, SOLE] })) w.cloud.sqlite.exec(s);
    for (const table of DATA) expect(w.rows(table, TENANT_ID)).toBeGreaterThan(0);
    expect(w.rows("tenant_domains", TENANT_ID)).toBe(1);
    expect(w.rows("memberships", TENANT_ID)).toBe(3);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(1);
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
    expect(w.out.join("\n")).not.toContain("removed");
  });
});

describe("undo only removes an untouched or partial import (not live yet)", () => {
  it.each([
    ["a payment created after the import", (w: any) => w.cloud.sqlite.exec(`INSERT INTO payments (tenant_id, id, code, parent_name, phone, amount_cents, expected_cents, transfer_date, bank, receipt_key, receipt_type, receipt_size, receipt_sha256, collection_id, status, created_at, updated_at) SELECT tenant_id, 'new-payment', 'C-NEW', parent_name, phone, amount_cents, expected_cents, transfer_date, bank, receipt_key, receipt_type, receipt_size, receipt_sha256, collection_id, status, created_at, updated_at FROM payments WHERE id = 'pay-1'`)],
    ["a collection created after the import", (w: any) => w.addCollection(TENANT_ID, "new-collection", "nuevo-demo")],
    ["a movement created after the import", (w: any) => w.cloud.sqlite.exec(`INSERT INTO bank_movements (tenant_id, id, transaction_number, amount_cents, received_at, payer_name, match_status, created_at) VALUES ('${TENANT_ID}', 'new-mov', 'TX-NEW', 1, '${NOW}', 'X', 'unmatched', '${NOW}')`)],
    ["more students than the plan has", (w: any) => w.cloud.sqlite.exec(`INSERT INTO students (tenant_id, payment_id, given_names, surnames, option_key, option_cents) VALUES ('${TENANT_ID}', 'pay-1', 'Extra', 'Demo', 'a', 1)`)],
  ])("refuses both undos after %s, deleting nothing", (_n, change) => {
    for (const level of [false, true]) {
      const w = imported();
      change(w);
      expect(w.undo(level)).toBe(1);
      expect(w.statements).toEqual([]);
      expect(w.out.join("\n")).toMatch(/not part of the import/);
    }
  });

  it("still works on a partial import (rows are a subset of the plan)", () => {
    const w = imported();
    w.cloud.sqlite.exec("DELETE FROM bank_movements; DELETE FROM students WHERE given_names = 'Alumno 9'; DELETE FROM payments WHERE id = 'pay-3'");
    expect(w.undo(false)).toBe(0);
    for (const table of DATA) expect(w.rows(table, TENANT_ID)).toBe(0);
  });

  it("refuses without the plan, or with a workdir that is not the import's, and points at the runbook", () => {
    const w = imported({ plan: false });
    expect(w.undo(false)).toBe(1);
    expect(w.statements).toEqual([]);
    expect(w.out.join("\n")).toMatch(/runbook/);
    const other = imported();
    expect(other.undo(false, { tenantId: OTHER })).toBe(1);
    expect(other.statements).toEqual([]);
  });
});

describe("undo-tenant", () => {
  it("removes the tenant scoped rows and the tenant, every sole-member user of any role, and keeps the rest", () => {
    const w = imported();
    expect(w.undo(true)).toBe(0);
    for (const table of [...DATA, "sessions", "magic_links", "memberships", "tenant_domains"]) expect(w.rows(table, TENANT_ID)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id IN ('${OWNER}', '${SOLE}')`)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${SHARED}'`)).toBe(1);
    expect(w.rows("collections", OTHER)).toBe(1);
    expect(w.rows("memberships", OTHER)).toBe(1);
  });

  it("keeps a user that has another membership, whatever the role", () => {
    const w = imported();
    w.cloud.sqlite.exec(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ('${OTHER}', '${OWNER}', 'co_treasurer', '${NOW}')`);
    expect(w.undo(true)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(1);
  });

  it("only ever names the target tenant, deletes the user rows after the memberships and the tenant row last", () => {
    const w = imported();
    w.undo(true);
    const tables = w.statements.map((s) => /^DELETE FROM (\w+)/.exec(s)![1]);
    expect(tables).toEqual(["bank_movements", "students", "payments", "collections", "sessions", "magic_links", "memberships", "users", "users", "users", "tenant_domains", "tenants"]);
    for (const s of w.statements) {
      expect(s).not.toContain(OTHER);
      expect(s).toContain(`'${TENANT_ID}'`);
      expect(s).toContain("source = 'pilot_import'");
    }
    for (const s of w.statements.filter((q) => q.startsWith("DELETE FROM users"))) expect(s).toContain("NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ");
    expect(w.statements.at(-1)).toBe(`DELETE FROM tenants WHERE id = '${TENANT_ID}' AND source = 'pilot_import';`);
  });

  it("writes the user ids it is about to delete to the workdir first (0600), so a rerun can finish", () => {
    const w = imported();
    w.undo(true);
    const file = join(w.dir, "undo-users.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).sort()).toEqual([OWNER, SHARED, SOLE].sort());
  });

  // A crash at any step (the statement ran but the answer was lost, or it never ran) must be finished by a rerun.
  const STEPS = 12;
  it.each(Array.from({ length: STEPS }, (_, i) => i + 1))("a crash after statement %i is completed by a rerun, with no stranded user", (k) => {
    for (const ran of [true, false]) {
      const w = imported();
      w.hooks.skip = () => !ran && w.statements.length === k;
      w.hooks.afterMutate = (n) => { if (n === k) throw new Error("connection lost"); };
      expect(w.undo(true)).toBe(1);
      w.hooks.afterMutate = undefined;
      w.hooks.skip = undefined;
      expect(w.undo(true)).toBe(0);
      expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id IN ('${OWNER}', '${SOLE}')`)).toBe(0);
      expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(0);
      expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${SHARED}'`)).toBe(1);
      expect(w.rows("memberships", OTHER)).toBe(1);
    }
  });

  it("does not report success while a membership, session, link, domain or sole-member user remains", () => {
    for (const table of ["memberships", "magic_links", "tenant_domains", "users"]) {
      const w = imported();
      w.hooks.skip = (q) => q.startsWith(`DELETE FROM ${table} `);
      expect(w.undo(true), table).toBe(1);
      expect(w.out.join("\n"), table).not.toContain("tenant removed");
    }
  });

  it("refuses an id that is not a plain id", () => {
    expect(() => undoStatements(TENANT_ID, { tenant: true, userIds: ["x'; DROP TABLE tenants; --"] })).toThrow();
  });
});

describe("undo-tenant of a tenant that has no import plan (a provisioning that did not finish)", () => {
  const unfinished = (state = "provisioning") => {
    const w = imported({ plan: false });
    const m = readManifest(w.dir);
    m.tenant = { id: TENANT_ID, slug: SLUG, state };
    writeManifest(w.dir, m);
    return w;
  };

  it("removes a tenant with zero data rows and clears the tenant (and any plan record) from the manifest so provisioning can run again", () => {
    const w = unfinished();
    expect(w.undo(true)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(0);
    expect(readManifest(w.dir).tenant).toBeUndefined();
    expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${OTHER}'`)).toBe(1);
  });

  it("never deletes the owner the manifest says was reused, and does not count it as a leftover", () => {
    const w = unfinished();
    const m = readManifest(w.dir);
    m.tenant.reusedOwnerId = OWNER;
    writeManifest(w.dir, m);
    expect(w.undo(true)).toBe(0);
    expect(w.statements.some((s) => s.includes(`'${OWNER}'`) && s.startsWith("DELETE FROM users"))).toBe(false);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(1);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${SOLE}'`)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(0);
    expect(readFileSync(join(w.dir, "undo-users.json"), "utf8")).not.toContain(OWNER);
  });

  it("drops the reused id from a stale undo-users.json written by an earlier run", () => {
    const w = unfinished();
    const m = readManifest(w.dir);
    m.tenant.reusedOwnerId = OWNER;
    writeManifest(w.dir, m);
    writeFileSync(join(w.dir, "undo-users.json"), JSON.stringify([OWNER, SOLE]));
    expect(w.undo(true)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(1);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${SOLE}'`)).toBe(0);
  });

  it("a rerun after the tenant row is gone keeps the reused owner and still verifies", () => {
    const w = imported({ plan: false, tenant: null });
    const m = readManifest(w.dir);
    m.tenant = { id: TENANT_ID, slug: SLUG, state: "provisioning", reusedOwnerId: OWNER };
    writeManifest(w.dir, m);
    writeFileSync(join(w.dir, "undo-users.json"), JSON.stringify([OWNER]));
    expect(w.undo(true)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(1);
    expect(readManifest(w.dir).tenant).toBeUndefined();
  });

  it("refuses, deleting nothing, when the manifest has a reused owner but names another tenant", () => {
    const w = imported();
    const m = readManifest(w.dir);
    m.tenant = { id: OTHER, slug: "otro-curso", state: "provisioned", reusedOwnerId: OWNER };
    writeManifest(w.dir, m);
    expect(w.undo(true)).toBe(1);
    expect(w.statements).toEqual([]);
    expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(1);
  });

  it.each([[null], [""], [42], ["x'; DROP TABLE users; --"], [["a"]]])("refuses, deleting nothing, when the manifest says an owner was reused but the id is malformed (%j)", (bad) => {
    const w = unfinished();
    const m = readManifest(w.dir);
    m.tenant.reusedOwnerId = bad;
    writeManifest(w.dir, m);
    expect(w.undo(true)).toBe(1);
    expect(w.statements).toEqual([]);
    expect(w.one(`SELECT COUNT(*) AS n FROM tenants WHERE id = '${TENANT_ID}'`)).toBe(1);
  });

  it("an owner that was not reused is deleted as before", () => {
    const w = unfinished();
    expect(w.undo(true)).toBe(0);
    expect(w.one(`SELECT COUNT(*) AS n FROM users WHERE id = '${OWNER}'`)).toBe(0);
  });

  it("refuses when the tenant has any row in the four data tables (it may be live), deleting nothing", () => {
    const w = unfinished();
    w.addCollection(TENANT_ID, "c-live", "vivo-demo");
    expect(w.undo(true)).toBe(1);
    expect(w.statements).toEqual([]);
    expect(readManifest(w.dir).tenant).toBeDefined();
  });

  it("refuses when the manifest names another tenant or none, and the data-level undo still needs the plan", () => {
    const w = unfinished();
    const m = readManifest(w.dir);
    m.tenant = { id: OTHER, slug: "otro-curso", state: "provisioning" };
    writeManifest(w.dir, m);
    expect(w.undo(true)).toBe(1);
    delete m.tenant;
    writeManifest(w.dir, m);
    expect(w.undo(true)).toBe(1);
    expect(unfinished().undo(false)).toBe(1);
    expect(w.statements).toEqual([]);
  });

  it("when the tenant row was never written, only the manifest is cleared", () => {
    const w = imported({ plan: false, tenant: null });
    const m = readManifest(w.dir);
    m.tenant = { id: TENANT_ID, slug: SLUG, state: "provisioning" };
    writeManifest(w.dir, m);
    expect(w.undo(true)).toBe(0);
    expect(readManifest(w.dir).tenant).toBeUndefined();
  });

  it("after an undo with a plan the manifest is cleared as well", () => {
    const w = imported();
    expect(w.undo(true)).toBe(0);
    const m = readManifest(w.dir);
    expect(m.tenant).toBeUndefined();
    expect(m.plan).toBeUndefined();
  });
});
