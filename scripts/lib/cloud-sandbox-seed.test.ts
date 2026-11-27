import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { parseHost, isValidSlug } from "../../src/worker/tenancy/host";
import { parseInstanceConfig } from "../../src/shared/instance-validation";
// @ts-expect-error plain .mjs module without types
import { buildSandboxSeedSql } from "./cloud-sandbox-seed.mjs";

const WORKERS = ["rekauda-sandbox-a", "rekauda-sandbox-b"];
const ROOT = "example-sub.workers.dev";
const NOW = "2026-11-26T00:00:00.000Z";
const build = (workers: string[] = WORKERS, root = ROOT): string => buildSandboxSeedSql({ workers, rootDomain: root, now: NOW });

const MIGRATIONS = new URL("../../migrations-cloud/", import.meta.url);
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  return db;
}
type Row = Record<string, string | null>;
const all = (db: DatabaseSync, sql: string): Row[] => db.prepare(sql).all() as Row[];

describe("buildSandboxSeedSql", () => {
  it("creates one active cloud tenant per sandbox worker, slug = worker name", () => {
    const db = freshDb();
    db.exec(build());
    const tenants = all(db, "SELECT * FROM tenants ORDER BY slug");
    expect(tenants.map((t) => t.slug)).toEqual(WORKERS);
    for (const t of tenants) {
      expect(t.status).toBe("active");
      expect(t.source).toBe("cloud");
      expect(t.r2_prefix).toBe(`t/${t.id}/`);
      expect(t.inbound_token_hash).toBeNull();
      expect(t.created_at).toBe(NOW);
    }
    expect(new Set(tenants.map((t) => t.id)).size).toBe(WORKERS.length);
  });

  it("adds a subdomain domain row <worker>.<ROOT_DOMAIN> that resolves like the tenancy rules", () => {
    const db = freshDb();
    db.exec(build());
    const domains = all(db, "SELECT d.hostname, d.kind, d.verified_at, t.slug FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id ORDER BY t.slug");
    expect(domains).toHaveLength(WORKERS.length);
    for (const row of domains) {
      expect(row.kind).toBe("subdomain");
      expect(row.hostname).toBe(`${row.slug}.${ROOT}`);
      expect(parseHost(row.hostname as string, ROOT)).toEqual({ kind: "subdomain", slug: row.slug, hostname: row.hostname });
      expect(isValidSlug(row.slug as string)).toBe(true);
    }
  });

  it("stores a fictional config_json that passes parseInstanceConfig", () => {
    const db = freshDb();
    db.exec(build());
    const tenants = all(db, "SELECT slug, config_json FROM tenants ORDER BY slug");
    const schools = tenants.map((t) => {
      const config = parseInstanceConfig(JSON.parse(t.config_json as string), `tenant ${t.slug}`);
      expect(config.analytics.gaMeasurementId).toBeNull();
      expect(config.treasury.accountNumber).toMatch(/^0+$/);
      expect(config.treasury.holderId).toMatch(/^0+$/);
      return config.schoolName;
    });
    expect(schools).toEqual(["Colegio Demo A", "Colegio Demo B"]);
  });

  it("is idempotent: running it twice changes nothing", () => {
    const db = freshDb();
    db.exec(build());
    const before = all(db, "SELECT * FROM tenants ORDER BY slug");
    db.exec(build());
    expect(all(db, "SELECT * FROM tenants ORDER BY slug")).toEqual(before);
    expect(all(db, "SELECT * FROM tenant_domains")).toHaveLength(WORKERS.length);
  });

  it("creates no users, memberships, sessions, login tokens or collections", () => {
    const db = freshDb();
    db.exec(build());
    const tables = all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name as string);
    for (const table of tables.filter((t) => !["tenants", "tenant_domains"].includes(t))) {
      expect(all(db, `SELECT 1 AS x FROM ${table}`), table).toEqual([]);
    }
  });

  it("only inserts with ON CONFLICT DO NOTHING (no deletes, updates, drops or secrets)", () => {
    const sql = build();
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|DROP|ALTER|REPLACE)\b/i);
    expect(sql.match(/INSERT INTO/g)).toHaveLength(2);
    expect(sql.match(/ON CONFLICT DO NOTHING/g)).toHaveLength(2);
    expect(sql).not.toMatch(/@|--remote|\btoken\b|password|secret/i);
  });

  it("is deterministic for the same input and escapes nothing unexpected", () => {
    expect(build()).toBe(build());
    expect(build(["rekauda-sandbox-a"])).not.toBe(build());
  });

  it("gives each worker a stable id derived from its name, not from its position", () => {
    const idOf = (sql: string, slug: string) => new RegExp(`\\('([0-9a-f-]{36})', '${slug}'`).exec(sql)?.[1];
    expect(idOf(build(), "rekauda-sandbox-b")).toBeDefined();
    expect(idOf(build(), "rekauda-sandbox-b")).toBe(idOf(build(["rekauda-sandbox-b", "rekauda-sandbox-a"]), "rekauda-sandbox-b"));
  });

  it.each([
    ["no workers", [], ROOT],
    ["invalid slug", ["Bad_Sandbox"], ROOT],
    ["no rekauda-sandbox- prefix", ["my-sandbox-a"], ROOT],
    ["a name that only contains sandbox", ["a-rekauda-sandbox-b"], ROOT],
    ["double hyphen", ["fixture--sandbox"], ROOT],
    ["a quote in the name", ["fix'sandbox"], ROOT],
    ["duplicates", ["rekauda-sandbox-a", "rekauda-sandbox-a"], ROOT],
    ["root not on workers.dev", WORKERS, "sandbox.example.net"],
    ["root is bare workers.dev", WORKERS, "workers.dev"],
  ])("throws on %s", (_label, workers, root) => {
    expect(() => build(workers as string[], root as string)).toThrow();
  });
});
