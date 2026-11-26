import { describe, expect, it } from "vitest";
import { checkCloudConfig } from "./cloud-guard-core.mjs";

// Fixtures use invented names and ids only. The "pilot" reference stands in for the local wrangler.jsonc.
const PILOT_DB_ID = "11111111-aaaa-bbbb-cccc-222222222222";
const FRESH_DB_ID = "99999999-aaaa-bbbb-cccc-888888888888";
const APEX = "apex.example.org";
const pilot = {
  name: "fixture-pilot",
  account_id: "acct-fixture-0001",
  d1_databases: [{ database_name: "fixture-pilot-db", database_id: PILOT_DB_ID }],
  r2_buckets: [{ bucket_name: "fixture-pilot-bucket" }],
  ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "4242" }],
  routes: [{ pattern: APEX, custom_domain: true }],
};
const pilotExample = { name: "example-name", d1_databases: [{ database_name: "example-db", database_id: "00000000-0000-0000-0000-000000000000" }] };

function fresh(overrides: Record<string, unknown> = {}) {
  return {
    name: "cloud-fresh",
    d1_databases: [{ binding: "DB", database_name: "cloud-fresh-db", database_id: FRESH_DB_ID, migrations_dir: "migrations-cloud" }],
    r2_buckets: [{ binding: "RECEIPTS", bucket_name: "cloud-fresh-files" }],
    ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "7001" }],
    ...overrides,
  };
}

type Extra = { mode?: string; pilot?: unknown; extraDenylist?: unknown };
const run = (target: unknown, extra: Extra = {}) =>
  checkCloudConfig({ target, pilot: "pilot" in extra ? extra.pilot : pilot, pilotExample, mode: extra.mode ?? "local", extraDenylist: extra.extraDenylist });

const fields = (result: { violations: { field: string }[] }) => result.violations.map((v) => v.field);
const withD1 = (patch: Record<string, unknown>) => fresh({ d1_databases: [{ ...fresh().d1_databases[0], ...patch }] });

describe("checkCloudConfig: allowed", () => {
  it("passes an all-fresh config in local mode", () => {
    expect(run(fresh())).toEqual({ ok: true, violations: [], warnings: [] });
  });

  it("passes with a warning, never ids, when no real pilot data is known", () => {
    const result = run(fresh(), { pilot: null });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no real pilot data");
  });

  it("treats values copied from the pilot example as placeholders, not as pilot data", () => {
    const placeholderPilot = { name: "example-name", d1_databases: [{ database_name: "example-db", database_id: "00000000-0000-0000-0000-000000000000" }] };
    const result = run(withD1({ database_name: "example-db", database_id: "00000000-0000-0000-0000-000000000000" }), { pilot: placeholderPilot });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("checkCloudConfig: pilot resources (deep scan)", () => {
  it.each([
    ["name", fresh({ name: "fixture-pilot" }), "name"],
    ["name, other case and spaces", fresh({ name: "  Fixture-PILOT " }), "name"],
    ["database_name", withD1({ database_name: "fixture-pilot-db" }), "d1_databases.database_name"],
    ["database_id", withD1({ database_id: PILOT_DB_ID }), "d1_databases.database_id"],
    ["database_id, uppercase", withD1({ database_id: PILOT_DB_ID.toUpperCase() }), "d1_databases.database_id"],
    ["bucket", fresh({ r2_buckets: [{ bucket_name: "fixture-pilot-bucket" }] }), "r2_buckets.bucket_name"],
    ["account_id", fresh({ account_id: "acct-fixture-0001" }), "account_id"],
    ["ratelimit namespace_id", fresh({ ratelimits: [{ name: "X", namespace_id: "4242" }] }), "ratelimits.namespace_id"],
    ["ratelimit namespace_id as number", fresh({ ratelimits: [{ name: "X", namespace_id: 4242 }] }), "ratelimits.namespace_id"],
    ["resource buried in services", fresh({ services: [{ binding: "S", service: "fixture-pilot" }] }), "services.service"],
    ["resource buried in kv", fresh({ kv_namespaces: [{ binding: "K", id: PILOT_DB_ID }] }), "kv_namespaces.id"],
    ["resource buried in queues", fresh({ queues: { producers: [{ queue: "fixture-pilot-bucket" }] } }), "queues.producers.queue"],
  ])("refuses a shared %s", (_label, target, field) => {
    const result = run(target);
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain(field);
  });

  it("uses names and ids from the local denylist file too", () => {
    const extraDenylist = { names: ["Local-Only-Name"], ids: ["77777777-0000-0000-0000-000000000000"], domains: [] };
    expect(fields(run(fresh({ name: "local-only-name" }), { pilot: null, extraDenylist }))).toContain("name");
    expect(fields(run(withD1({ database_id: "77777777-0000-0000-0000-000000000000" }), { pilot: null, extraDenylist }))).toContain("d1_databases.database_id");
  });

  it("never prints ids, names or secrets in the output", () => {
    const text = JSON.stringify(run(withD1({ database_id: PILOT_DB_ID, database_name: "fixture-pilot-db" })));
    expect(text).toContain("d1_databases.database_id");
    for (const secret of [PILOT_DB_ID, "fixture-pilot-db", "4242", "acct-fixture-0001"]) expect(text).not.toContain(secret);
  });

  it("refuses a non-empty env section", () => {
    expect(fields(run(fresh({ env: { staging: { name: "x" } } })))).toContain("env");
  });

  it("allows an empty env section", () => {
    expect(run(fresh({ env: {} })).ok).toBe(true);
  });

  it.each([[{ r2_buckets: [{ binding: "R", bucket_name: "cloud-fresh-files", remote: true }] }], [{ remote: true }]])("refuses remote: true anywhere (%j)", (patch) => {
    expect(fields(run(fresh(patch)))).toContain("remote");
  });
});

describe("checkCloudConfig: routes and the apex", () => {
  const apexRoutes = [
    [{ pattern: APEX, custom_domain: true }],
    [{ pattern: `${APEX}/*`, zone_name: APEX }],
    [`${APEX}/*`],
    [`HTTPS://${APEX.toUpperCase()}.:443/*`],
    [{ pattern: `*${APEX}/*` }],
    [{ pattern: "*/*" }],
  ];
  it.each(apexRoutes)("refuses a route covering the apex: %j", (...routes) => {
    expect(fields(run(fresh({ routes })))).toContain("routes");
  });

  it("refuses a route inside the pilot domain", () => {
    expect(fields(run(fresh({ routes: [`demo.${APEX}/*`] })))).toContain("routes");
  });

  it("refuses a wildcard on the pilot domain without the sandbox flag", () => {
    expect(fields(run(fresh({ routes: [`*.${APEX}/*`] })))).toContain("routes");
  });

  it("allows the wildcard only when vars.SANDBOX is true", () => {
    expect(run(fresh({ routes: [`*.${APEX}/*`], vars: { SANDBOX: "true" } })).ok).toBe(true);
  });

  it("never allows the wildcard together with the apex, even in sandbox", () => {
    const target = fresh({ routes: [`*.${APEX}/*`, `${APEX}/*`], vars: { SANDBOX: "true" } });
    expect(fields(run(target))).toContain("routes");
  });

  it("reads the singular route key too", () => {
    expect(fields(run(fresh({ route: `${APEX}/*` })))).toContain("routes");
  });

  it("refuses a zone_name equal to the pilot domain unless sandbox", () => {
    expect(fields(run(fresh({ routes: [{ pattern: "elsewhere.example.net/*", zone_name: APEX }] })))).toContain("routes");
    expect(run(fresh({ routes: [{ pattern: "elsewhere.example.net/*", zone_name: APEX }], vars: { SANDBOX: "true" } })).ok).toBe(true);
  });

  it("refuses a star that is not the leading label", () => {
    expect(fields(run(fresh({ routes: ["a*.sandbox.example.net/*"] })))).toContain("routes");
  });

  it.each([[{ routes: "not-an-array" }], [{ routes: [42] }], [{ routes: [{ custom_domain: true }] }], [{ route: { zone_name: "x" } }], [{ route: 7 }]])("fails closed on malformed routes: %j", (patch) => {
    expect(fields(run(fresh(patch)))).toContain("routes");
  });
});

describe("checkCloudConfig: migrations_dir", () => {
  it.each([[undefined], ["migrations"], ["migrations/"], ["./migrations"], ["Migrations"]])("refuses migrations_dir %s", (dir) => {
    expect(fields(run(withD1({ migrations_dir: dir })))).toContain("d1_databases.migrations_dir");
  });

  it("accepts migrations-cloud in any case or with ./ and a trailing slash", () => {
    expect(run(withD1({ migrations_dir: "./Migrations-Cloud/" })).ok).toBe(true);
  });

  it("refuses a config without any D1 database", () => {
    expect(fields(run(fresh({ d1_databases: [] })))).toContain("d1_databases.migrations_dir");
  });
});

describe("checkCloudConfig: remote and fail-closed", () => {
  it("refuses remote even for a fresh config", () => {
    expect(fields(run(fresh(), { mode: "remote" }))).toContain("mode");
  });

  it("refuses remote when ids are placeholders", () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    expect(fields(run(withD1({ database_id: zero }), { mode: "remote" }))).toContain("d1_databases.database_id");
  });

  it("refuses remote when only placeholder pilot data is known", () => {
    const placeholderPilot = { name: "example-name" };
    expect(fields(run(fresh(), { mode: "remote", pilot: placeholderPilot }))).toContain("pilot");
  });

  it("refuses remote when no pilot data exists", () => {
    expect(fields(run(fresh(), { mode: "remote", pilot: null }))).toContain("pilot");
  });

  it.each([[null], [undefined], ["text"], [[]]])("fails closed for a non-object target: %j", (target) => {
    expect(run(target).ok).toBe(false);
  });

  it("fails closed for an unknown mode", () => {
    expect(run(fresh(), { mode: "sideways" }).ok).toBe(false);
  });
});
