import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc.mjs";
// @ts-expect-error plain .mjs module without types
import { checkProductionConfig } from "./cloud-guard-core.mjs";
import { legacyRedirectsValid, parseLegacyRedirects } from "../../src/worker/apex/legacy-redirects";

// Invented fixtures only. `pilot` stands in for the local pilot wrangler.jsonc; `sandboxCfg` for wrangler.sandbox.jsonc.
const PILOT_ACCOUNT = "acct-fixture-0001";
const PILOT_DB_ID = "11111111-aaaa-bbbb-cccc-222222222222";
const SANDBOX_DB_ID = "99999999-aaaa-bbbb-cccc-888888888888";
const PROD_DB_ID = "55555555-aaaa-bbbb-cccc-444444444444";
const pilot = {
  name: "fixture-pilot",
  account_id: PILOT_ACCOUNT,
  d1_databases: [{ database_name: "fixture-pilot-db", database_id: PILOT_DB_ID }],
  r2_buckets: [{ bucket_name: "fixture-pilot-bucket" }],
  ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "4242" }],
};
const sandboxCfg = {
  name: "rekauda-sandbox-a",
  account_id: PILOT_ACCOUNT,
  d1_databases: [{ database_name: "rekauda-sandbox-db", database_id: SANDBOX_DB_ID }],
  r2_buckets: [{ bucket_name: "rekauda-sandbox-files" }],
  ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "3002" }],
};
const REF = { productionRoot: "colegio-demo.example.test" };
const pilotExample = { name: "example-name", d1_databases: [{ database_name: "example-db", database_id: "00000000-0000-0000-0000-000000000000" }] };
const ROOT = "colegio-demo.example.test";
const WILDCARD = { pattern: `*.${ROOT}/*`, zone_name: ROOT };
const APEX_ROUTE = { pattern: `${ROOT}/*`, zone_name: ROOT };

function prod(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    name: "rekauda-cloud-app",
    main: "src/worker/index.ts",
    account_id: PILOT_ACCOUNT,
    workers_dev: false,
    preview_urls: false,
    routes: [WILDCARD],
    vars: { TENANCY: "multi", ROOT_DOMAIN: ROOT, INBOUND_DOMAIN: `in.${ROOT}` },
    d1_databases: [{ binding: "DB", database_name: "rekauda-cloud-db", database_id: PROD_DB_ID, migrations_dir: "migrations-cloud" }],
    r2_buckets: [
      { binding: "RECEIPTS", bucket_name: "rekauda-cloud-files" },
      { binding: "MAIL_ARCHIVE", bucket_name: "rekauda-cloud-mail" },
    ],
    ratelimits: [1, 2, 3].map((n) => ({ name: `LIMITER_${n}`, namespace_id: String(7000 + n), simple: { limit: 5, period: 60 } })),
    send_email: [{ name: "SEND_EMAIL" }],
    triggers: { crons: ["17 3 * * *"] },
    ...overrides,
  };
}
const withVars = (patch: Record<string, unknown>) => prod({ vars: { ...prod().vars, ...patch } });
const withD1 = (patch: Record<string, unknown>) => prod({ d1_databases: [{ ...prod().d1_databases[0], ...patch }] });
const limiter = (id: string) => prod({ ratelimits: prod().ratelimits.map((r: any, i: number) => (i === 0 ? { ...r, namespace_id: id } : r)) });

type Extra = { targetFile?: string; pilot?: unknown; extraDenylist?: unknown; apex?: string };
const run = (target: unknown, extra: Extra = {}) =>
  checkProductionConfig({
    target,
    targetFile: extra.targetFile ?? "wrangler.production.jsonc",
    pilot: "pilot" in extra ? extra.pilot : pilot,
    pilotExample,
    sandbox: sandboxCfg,
    extraDenylist: "extraDenylist" in extra ? extra.extraDenylist : REF,
    apex: extra.apex ?? "forbid",
  });
const fields = (r: { violations: { field: string }[] }) => r.violations.map((v) => v.field);

describe("checkProductionConfig: allowed", () => {
  it("accepts a valid production fixture", () => expect(run(prod())).toEqual({ ok: true, violations: [], warnings: [] }));

  it("accepts real pilot data that comes only from .pilot-resources.json", () => {
    const extra = { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"], ...REF };
    expect(run(prod(), { pilot: null, extraDenylist: extra }).ok).toBe(true);
  });

  it("allows the pilot account_id, and the legacy map for the production root", () => {
    expect(run(prod({ account_id: PILOT_ACCOUNT.toUpperCase() })).ok).toBe(true);
    const legacy = { "/r/curso-demo": `https://curso-demo.${ROOT}/r/curso-demo` };
    expect(run(withVars({ LEGACY_REDIRECTS: legacy })).ok).toBe(true);
  });

  it("refuses the untouched example (placeholders) and accepts it once filled in", async () => {
    const { readFileSync } = await import("node:fs");
    const example = parseJsonc(readFileSync(new URL("../../wrangler.production.example.jsonc", import.meta.url), "utf8"));
    expect(run(example).violations.map((v: any) => v.field).sort()).toEqual(["d1_databases.database_id", "ratelimits.namespace_id"]);
    const ratelimits = example.ratelimits.map((r: any, i: number) => ({ ...r, namespace_id: String(7001 + i) }));
    expect(run({ ...example, d1_databases: [{ ...example.d1_databases[0], database_id: PROD_DB_ID }], ratelimits }).violations).toEqual([]);
  });
});

describe("checkProductionConfig: refused one violation at a time", () => {
  it.each([
    ["Worker name without the prefix", () => prod({ name: "other-app" }), "name"],
    ["Worker name is the pilot's", () => prod({ name: "fixture-pilot" }), "name"],
    ["D1 name without the prefix", () => withD1({ database_name: "other-db" }), "d1_databases.database_name"],
    ["bucket without the prefix", () => prod({ r2_buckets: [{ binding: "RECEIPTS", bucket_name: "files" }, prod().r2_buckets[1]] }), "r2_buckets.bucket_name"],
    ["pilot D1 id", () => withD1({ database_id: PILOT_DB_ID }), "d1_databases.database_id"],
    ["pilot D1 id, upper case and without hyphens", () => withD1({ database_id: PILOT_DB_ID.toUpperCase().replaceAll("-", "") }), "d1_databases.database_id"],
    ["pilot bucket", () => prod({ r2_buckets: [prod().r2_buckets[0], { binding: "MAIL_ARCHIVE", bucket_name: "fixture-pilot-bucket" }] }), "r2_buckets.bucket_name"],
    ["pilot ratelimit id", () => limiter("4242"), "ratelimits.namespace_id"],
    ["sandbox D1 id", () => withD1({ database_id: SANDBOX_DB_ID }), "d1_databases.database_id"],
    ["sandbox ratelimit id", () => limiter("3002"), "ratelimits.namespace_id"],
    ["placeholder D1 id", () => withD1({ database_id: "00000000-0000-0000-0000-000000000000" }), "d1_databases.database_id"],
    ["placeholder ratelimit id", () => limiter("0"), "ratelimits.namespace_id"],
    ["two ratelimits", () => prod({ ratelimits: prod().ratelimits.slice(0, 2) }), "ratelimits"],
    ["four ratelimits", () => prod({ ratelimits: [...prod().ratelimits, { name: "X", namespace_id: "7009" }] }), "ratelimits"],
    ["workers_dev true", () => prod({ workers_dev: true }), "workers_dev"],
    ["wrong main", () => prod({ main: "other.ts" }), "main"],
    ["migrations dir", () => withD1({ migrations_dir: "migrations" }), "d1_databases.migrations_dir"],
    ["unknown top-level key", () => prod({ services: [{ binding: "S", service: "x" }] }), "services"],
    ["vars SANDBOX", () => withVars({ SANDBOX: "true" }), "vars.SANDBOX"],
    ["vars ADMIN_PASSWORD", () => withVars({ ADMIN_PASSWORD: "x" }), "vars.ADMIN_PASSWORD"],
    ["vars FORWARD_TO", () => withVars({ FORWARD_TO: "a@example.test" }), "vars.FORWARD_TO"],
    ["TENANCY single", () => withVars({ TENANCY: "single" }), "vars.TENANCY"],
    ["workers.dev root", () => withVars({ ROOT_DOMAIN: "x.workers.dev" }), "vars.ROOT_DOMAIN"],
    ["inbound domain mismatch", () => withVars({ INBOUND_DOMAIN: "mail.example.test" }), "vars.INBOUND_DOMAIN"],
    ["open redirect in the legacy map", () => withVars({ LEGACY_REDIRECTS: { "/r/curso-demo": "https://evil.example.test/r/curso-demo" } }), "vars.LEGACY_REDIRECTS"],
    ["extra route", () => prod({ routes: [WILDCARD, { pattern: "other.example.test/*", zone_name: ROOT }] }), "routes"],
    ["no wildcard route", () => prod({ routes: [] }), "routes"],
    ["route outside the allowlist", () => prod({ routes: [{ pattern: "*.other.example.test/*", zone_name: "other.example.test" }] }), "routes"],
    ["bare route key", () => prod({ routes: undefined, route: `*.${ROOT}/*` }), "route"],
    ["remote binding", () => prod({ r2_buckets: [{ ...prod().r2_buckets[0], remote: true }, prod().r2_buckets[1]] }), "r2_buckets"],
  ])("refuses %s", (_label, build, field) => {
    const result = run(build());
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain(field);
  });

  it.each([
    ["the sandbox config file", { targetFile: "wrangler.sandbox.jsonc" }],
    ["the pilot config file", { targetFile: "wrangler.jsonc" }],
  ])("refuses %s", (_label, extra) => expect(fields(run(prod(), extra))).toContain("config"));

  it.each([
    ["worker name", { d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"], ...REF }, "worker name"],
    ["D1 id", { workers: ["fixture-pilot"], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"], ...REF }, "D1 id"],
    ["R2 bucket", { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID], ratelimitIds: ["4242"], ...REF }, "R2 bucket"],
    ["ratelimit id", { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"], ...REF }, "ratelimit id"],
  ])("fails closed when pilot knowledge lacks the %s", (_label, extra, missing) => {
    const result = run(prod(), { pilot: null, extraDenylist: extra });
    expect(result.violations.find((v: any) => v.field === "pilot")?.reason).toContain(missing);
  });

  it.each([
    ["a root other than productionRoot", () => withVars({ ROOT_DOMAIN: "other-zone.example.test", INBOUND_DOMAIN: "in.other-zone.example.test" }), undefined],
    ["a missing productionRoot", () => prod(), {}],
    ["a non-string productionRoot", () => prod(), { productionRoot: 7 }],
    ["a pilot domain listed in domains", () => withVars({ ROOT_DOMAIN: "pilot-site.example.test", INBOUND_DOMAIN: "in.pilot-site.example.test" }), { ...REF, domains: ["Pilot-Site.example.test."] }],
  ])("refuses %s", (_label, build, extraDenylist) => {
    const result = run(build(), extraDenylist === undefined ? {} : { extraDenylist });
    expect(result.ok).toBe(false);
    expect(fields(result).some((f: string) => f === "pilot" || f === "vars.ROOT_DOMAIN")).toBe(true);
  });

  it("pins the root after lower-casing and trimming a trailing dot", () => {
    expect(run(prod(), { extraDenylist: { productionRoot: "COLEGIO-DEMO.example.test." } }).ok).toBe(true);
  });

  it.each([
    ["unknown assets key", () => prod({ assets: { directory: "./dist", extra: 1 } }), "assets"],
    ["assets directory", () => prod({ assets: { directory: "./other" } }), "assets.directory"],
    ["unknown images key", () => prod({ images: { binding: "IMAGES", x: 1 } }), "images"],
    ["unknown observability key", () => prod({ observability: { enabled: true, x: 1 } }), "observability"],
    ["non-UUID D1 id", () => withD1({ database_id: "not-a-uuid" }), "d1_databases.database_id"],
    ["leading-zero ratelimit id", () => limiter("04242"), "ratelimits.namespace_id"],
    ["signed ratelimit id", () => limiter("+4242"), "ratelimits.namespace_id"],
    ["decimal ratelimit id", () => limiter("4242.0"), "ratelimits.namespace_id"],
  ])("strict shape: refuses %s", (_label, build, field) => expect(fields(run(build()))).toContain(field));

  it("canonicalises ratelimit ids on the pilot side too", () => {
    const ref = { ...REF, ratelimitIds: ["04242"] };
    expect(fields(run(limiter("4242"), { pilot: null, extraDenylist: { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"], ...ref } }))).toContain("ratelimits.namespace_id");
  });

  it("compares sandbox ids in every hex spelling", () => {
    expect(fields(run(withD1({ database_id: SANDBOX_DB_ID.toUpperCase().replaceAll("-", "") })))).toContain("d1_databases.database_id");
  });

  it("never prints an id, a name or a secret", () => {
    const text = JSON.stringify(run(withD1({ database_id: PILOT_DB_ID }), { pilot: pilot }).violations);
    for (const secret of [PILOT_DB_ID, "fixture-pilot", PILOT_ACCOUNT, "4242"]) expect(text).not.toContain(secret);
  });
});

describe("checkProductionConfig: apex state per command", () => {
  const both = (route: unknown) => prod({ routes: [WILDCARD, route] });
  const forms = [APEX_ROUTE, { pattern: ROOT, custom_domain: true }];

  it.each(forms)("refuses the apex entry %j when apex is forbidden (deploy)", (route) => {
    const result = run(both(route), { apex: "forbid" });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("routes");
  });

  it.each(forms)("requires and allows the apex entry %j when apex is required (switch)", (route) => {
    expect(run(both(route), { apex: "require" }).ok).toBe(true);
    expect(fields(run(prod(), { apex: "require" }))).toContain("routes");
  });

  it("allows either state when apex is any (guard, migrate, status)", () => {
    expect(run(prod(), { apex: "any" }).ok).toBe(true);
    expect(run(both(APEX_ROUTE), { apex: "any" }).ok).toBe(true);
  });

  it("refuses two apex entries and an unknown apex policy", () => {
    expect(run(prod({ routes: [WILDCARD, APEX_ROUTE, forms[1]] }), { apex: "any" }).ok).toBe(false);
    expect(run(prod(), { apex: "maybe" }).ok).toBe(false);
  });
});

// The guard and the Worker use ONE parser (src/worker/apex/legacy-redirects.ts): what the guard accepts, the Worker serves.
describe("LEGACY_REDIRECTS parity between the guard and the Worker parser", () => {
  const ok = { "/r/curso-demo": `https://curso-demo.${ROOT}/r/curso-demo` };
  it.each([
    ["valid", ok],
    ["empty", {}],
    ["other host", { "/r/curso-demo": "https://evil.example.test/r/curso-demo" }],
    ["protocol-relative", { "/r/curso-demo": `//curso-demo.${ROOT}/r/curso-demo` }],
    ["http", { "/r/curso-demo": `http://curso-demo.${ROOT}/r/curso-demo` }],
    ["different slug", { "/r/curso-demo": `https://otro.${ROOT}/r/curso-demo` }],
    ["encoded slash", { "/r/curso%2fdemo": `https://curso%2fdemo.${ROOT}/r/curso%2fdemo` }],
    ["trailing slash key", { "/r/curso-demo/": `https://curso-demo.${ROOT}/r/curso-demo` }],
    ["uppercase key", { "/r/Curso-Demo": `https://curso-demo.${ROOT}/r/curso-demo` }],
    ["array", [ok]],
    ["string", "x"],
    ["null", null],
  ])("%s: the guard refuses exactly when the parser refuses", (_label, map) => {
    const guardRefuses = fields(run(withVars({ LEGACY_REDIRECTS: map }))).includes("vars.LEGACY_REDIRECTS");
    expect(guardRefuses).toBe(!legacyRedirectsValid(map, ROOT));
    if (guardRefuses) expect(parseLegacyRedirects(map, ROOT)).toEqual({});
    else expect(parseLegacyRedirects(map, ROOT)).toEqual(map);
  });
});
