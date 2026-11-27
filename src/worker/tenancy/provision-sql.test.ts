import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCloudTestDb } from "../test/d1-cloud";
import { OWNER_EMAIL, provisionTenantStatements } from "./provision-sql";

const ID = "c0000000-0000-4000-8000-0000000000c1";
const row = { id: ID, slug: "curso-demo", hostname: "curso-demo.example.test", configJson: '{"a":"x; y"}', ownerEmail: "owner@example.test", ownerId: "u-1", nowIso: "2026-11-27T00:00:00Z" };

function apply(statements: { sql: string; params: (string | null)[] }[]) {
  const db = createCloudTestDb();
  for (const s of statements) db.sqlite.prepare(s.sql).run(...s.params);
  return db.sqlite;
}

describe("provisionTenantStatements", () => {
  it("source cloud: tenant, subdomain, owner and membership, with the t/<id>/ prefix and no qr or token", () => {
    const sqlite = apply(provisionTenantStatements({ ...row, source: "cloud" }));
    expect(sqlite.prepare("SELECT source, r2_prefix, qr_key, inbound_token_hash FROM tenants").get()).toEqual({ source: "cloud", r2_prefix: `t/${ID}/`, qr_key: null, inbound_token_hash: null });
    expect(sqlite.prepare("SELECT hostname, kind FROM tenant_domains").get()).toEqual({ hostname: row.hostname, kind: "subdomain" });
    expect(sqlite.prepare("SELECT role FROM memberships").get()).toEqual({ role: "owner" });
  });

  it("source pilot_import: keeps the t/<id>/ prefix and stores the qr key and the token hash", () => {
    const hash = "ab".repeat(32);
    const qrKey = `t/${ID}/assets/deuna-qr.png`;
    const sqlite = apply(provisionTenantStatements({ ...row, source: "pilot_import", qrKey, inboundTokenHash: hash }));
    expect(sqlite.prepare("SELECT source, r2_prefix, qr_key, inbound_token_hash, updated_at FROM tenants").get()).toEqual({ source: "pilot_import", r2_prefix: `t/${ID}/`, qr_key: qrKey, inbound_token_hash: hash, updated_at: row.nowIso });
  });

  it("reuses an existing person with the same email as owner", () => {
    const db = createCloudTestDb();
    db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-old', 'owner@example.test', 'person', 'x')");
    for (const s of provisionTenantStatements({ ...row, source: "cloud" })) db.sqlite.prepare(s.sql).run(...s.params);
    expect(db.sqlite.prepare("SELECT user_id FROM memberships").get()).toEqual({ user_id: "u-old" });
  });

  it("uses numbered placeholders that match the params of each statement", () => {
    for (const s of provisionTenantStatements({ ...row, source: "cloud" })) {
      const max = Math.max(...[...s.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      expect(s.params).toHaveLength(max);
    }
  });

  it("refuses a source other than cloud or pilot_import", () => {
    expect(() => provisionTenantStatements({ ...row, source: "self_host" as never })).toThrow();
  });

  it("has zero imports, so Node can load it by type stripping", () => {
    expect(readFileSync(new URL("./provision-sql.ts", import.meta.url), "utf8")).not.toMatch(/^\s*(import|export)\b[^\n]*\bfrom\b/m);
  });

  it("OWNER_EMAIL accepts an address and rejects text without an at sign", () => {
    expect(OWNER_EMAIL.test("a@b.test")).toBe(true);
    expect(OWNER_EMAIL.test("not-an-email")).toBe(false);
  });
});
