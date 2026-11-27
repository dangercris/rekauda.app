import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module without types
import { checkCloudConfig, checkSandboxConfig } from "./cloud-guard-core.mjs";

// Fixtures use invented names and ids only. The "pilot" reference stands in for the local wrangler.jsonc.
const PILOT_ACCOUNT = "acct-fixture-0001";
const PILOT_DB_ID = "11111111-aaaa-bbbb-cccc-222222222222";
const SANDBOX_DB_ID = "99999999-aaaa-bbbb-cccc-888888888888";
const pilot = {
  name: "fixture-pilot",
  account_id: PILOT_ACCOUNT,
  d1_databases: [{ database_name: "fixture-pilot-db", database_id: PILOT_DB_ID }],
  r2_buckets: [{ bucket_name: "fixture-pilot-bucket" }],
  ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "4242" }],
};
const pilotExample = { name: "example-name", d1_databases: [{ database_name: "example-db", database_id: "00000000-0000-0000-0000-000000000000" }] };

function sandbox(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    name: "rekauda-sandbox-a",
    main: "src/worker/index.ts",
    workers_dev: true,
    preview_urls: false,
    vars: {
      SANDBOX: "true",
      TENANCY: "multi",
      ROOT_DOMAIN: "example-sub.workers.dev",
      INBOUND_DOMAIN: "in.example-sub.workers.dev",
      SANDBOX_WORKERS: ["rekauda-sandbox-a", "rekauda-sandbox-b"],
    },
    d1_databases: [{ binding: "DB", database_name: "rekauda-sandbox-db", database_id: SANDBOX_DB_ID, migrations_dir: "migrations-cloud" }],
    r2_buckets: [{ binding: "RECEIPTS", bucket_name: "rekauda-sandbox-files" }],
    ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "9101" }],
    ...overrides,
  };
}
const withVars = (patch: Record<string, unknown>) => sandbox({ vars: { ...sandbox().vars, ...patch } });
const withD1 = (patch: Record<string, unknown>) => sandbox({ d1_databases: [{ ...sandbox().d1_databases[0], ...patch }] });

type Extra = { targetFile?: string; pilot?: unknown; extraDenylist?: unknown };
const run = (target: unknown, extra: Extra = {}) =>
  checkSandboxConfig({
    target,
    targetFile: extra.targetFile ?? "wrangler.sandbox.jsonc",
    pilot: "pilot" in extra ? extra.pilot : pilot,
    pilotExample,
    extraDenylist: extra.extraDenylist,
  });
const fields = (result: { violations: { field: string }[] }) => result.violations.map((v) => v.field);

describe("checkSandboxConfig: allowed", () => {
  it("accepts a valid sandbox fixture", () => {
    expect(run(sandbox())).toEqual({ ok: true, violations: [], warnings: [] });
  });

  it("accepts real pilot data that comes only from .pilot-resources.json", () => {
    const extra = { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"] };
    expect(run(sandbox(), { pilot: null, extraDenylist: extra }).ok).toBe(true);
  });

  it("allows account_id equal to the pilot's, and only that value", () => {
    expect(run(sandbox({ account_id: PILOT_ACCOUNT })).ok).toBe(true);
    expect(run(sandbox({ account_id: PILOT_ACCOUNT.toUpperCase() })).ok).toBe(true);
  });

  it("still refuses the account id anywhere other than account_id", () => {
    const result = run(withVars({ NOTE: PILOT_ACCOUNT }));
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("vars.NOTE");
  });
});

describe("checkSandboxConfig: refused one violation at a time", () => {
  it("refuses the cloud config file: sandbox mode is never available for it", () => {
    const result = run(sandbox(), { targetFile: "wrangler.cloud.jsonc" });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("config");
  });

  it("refuses the pilot config file", () => {
    expect(run(sandbox(), { targetFile: "wrangler.jsonc" }).ok).toBe(false);
  });

  it.each([
    ["missing SANDBOX", () => withVars({ SANDBOX: undefined }), "vars.SANDBOX"],
    ["SANDBOX not the string true", () => withVars({ SANDBOX: true }), "vars.SANDBOX"],
    ["TENANCY single", () => withVars({ TENANCY: "single" }), "vars.TENANCY"],
    ["workers_dev false", () => sandbox({ workers_dev: false }), "workers_dev"],
    ["workers_dev missing", () => sandbox({ workers_dev: undefined }), "workers_dev"],
    ["routes present", () => sandbox({ routes: [{ pattern: "*.sandbox.example.net/*", zone_name: "sandbox.example.net" }] }), "routes"],
    ["empty routes present", () => sandbox({ routes: [] }), "routes"],
    ["route present", () => sandbox({ route: "sandbox.example.net/*" }), "route"],
    ["ROOT_DOMAIN not workers.dev", () => withVars({ ROOT_DOMAIN: "sandbox.example.net" }), "vars.ROOT_DOMAIN"],
    ["ROOT_DOMAIN only suffix-like", () => withVars({ ROOT_DOMAIN: "evilworkers.dev" }), "vars.ROOT_DOMAIN"],
    ["env sections", () => sandbox({ env: { prod: {} } }), "env"],
    ["name without sandbox", () => sandbox({ name: "fixture-cloud-a" }), "name"],
    ["SANDBOX_WORKERS entry without sandbox", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-a", "fixture-other-b"] }), "vars.SANDBOX_WORKERS"],
    ["SANDBOX_WORKERS missing", () => withVars({ SANDBOX_WORKERS: undefined }), "vars.SANDBOX_WORKERS"],
    ["SANDBOX_WORKERS empty", () => withVars({ SANDBOX_WORKERS: [] }), "vars.SANDBOX_WORKERS"],
    ["SANDBOX_WORKERS without the config name", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-b"] }), "vars.SANDBOX_WORKERS"],
    ["invalid slug (underscore)", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-a", "fixture_sandbox_b"] }), "vars.SANDBOX_WORKERS"],
    ["invalid slug (double hyphen)", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-a", "fixture--sandbox"] }), "vars.SANDBOX_WORKERS"],
    ["D1 name without sandbox", () => withD1({ database_name: "fixture-plain-db" }), "d1_databases.database_name"],
    ["R2 bucket without sandbox", () => sandbox({ r2_buckets: [{ binding: "RECEIPTS", bucket_name: "fixture-plain-files" }] }), "r2_buckets.bucket_name"],
    ["placeholder D1 id", () => withD1({ database_id: "00000000-0000-0000-0000-000000000000" }), "d1_databases.database_id"],
    ["wrong migrations_dir", () => withD1({ migrations_dir: "migrations" }), "d1_databases.migrations_dir"],
    ["remote bindings", () => sandbox({ r2_buckets: [{ binding: "RECEIPTS", bucket_name: "rekauda-sandbox-files", remote: true }] }), "remote"],
    ["name with sandbox but without the prefix", () => sandbox({ name: "my-sandbox-a", vars: { ...sandbox().vars, SANDBOX_WORKERS: ["my-sandbox-a", "rekauda-sandbox-b"] } }), "name"],
    ["SANDBOX_WORKERS entry without the prefix", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-a", "my-sandbox-b"] }), "vars.SANDBOX_WORKERS"],
    ["D1 name without the prefix", () => withD1({ database_name: "my-sandbox-db" }), "d1_databases.database_name"],
    ["R2 bucket without the prefix", () => sandbox({ r2_buckets: [{ binding: "RECEIPTS", bucket_name: "my-sandbox-files" }] }), "r2_buckets.bucket_name"],
    ["duplicate SANDBOX_WORKERS entries", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-a", "rekauda-sandbox-a"] }), "vars.SANDBOX_WORKERS"],
    ["non-string SANDBOX_WORKERS entry", () => withVars({ SANDBOX_WORKERS: ["rekauda-sandbox-a", 7] }), "vars.SANDBOX_WORKERS"],
    ["SANDBOX_WORKERS not a list", () => withVars({ SANDBOX_WORKERS: "rekauda-sandbox-a" }), "vars.SANDBOX_WORKERS"],
    ["non-string database_id", () => withD1({ database_id: 12345 }), "d1_databases.database_id"],
    ["ROOT_DOMAIN with an empty prefix", () => withVars({ ROOT_DOMAIN: ".workers.dev" }), "vars.ROOT_DOMAIN"],
    ["ROOT_DOMAIN that is only workers.dev", () => withVars({ ROOT_DOMAIN: "workers.dev" }), "vars.ROOT_DOMAIN"],
    ["ROOT_DOMAIN with several labels", () => withVars({ ROOT_DOMAIN: "a.b.workers.dev" }), "vars.ROOT_DOMAIN"],
    ["ROOT_DOMAIN not a string", () => withVars({ ROOT_DOMAIN: 5 }), "vars.ROOT_DOMAIN"],
    ["main outside the repo", () => sandbox({ main: "../x.ts" }), "main"],
    ["main missing", () => sandbox({ main: undefined }), "main"],
    ["second D1 database", () => sandbox({ d1_databases: [sandbox().d1_databases[0], { ...sandbox().d1_databases[0], binding: "X" }] }), "d1_databases"],
    ["D1 binding not DB", () => withD1({ binding: "OTHER" }), "d1_databases.binding"],
    ["D1 entry with an unknown key", () => withD1({ experimental_remote: true }), "d1_databases"],
    ["two R2 buckets", () => sandbox({ r2_buckets: [sandbox().r2_buckets[0], { binding: "MAIL_ARCHIVE", bucket_name: "rekauda-sandbox-mail" }] }), "r2_buckets"],
    ["R2 binding not RECEIPTS", () => sandbox({ r2_buckets: [{ binding: "OTHER", bucket_name: "rekauda-sandbox-files" }] }), "r2_buckets.binding"],
  ])("refuses %s", (_label, build, field) => {
    const result = run(build());
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain(field);
  });

  it("refuses a worker name equal to the pilot's in another case, with spaces", () => {
    const result = run(sandbox({ name: "  Fixture-Pilot  " }));
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("name");
  });

  it("refuses a SANDBOX_WORKERS entry equal to a pilot name even when it contains sandbox", () => {
    const sandboxNamedPilot = { ...pilot, name: "rekauda-sandbox-b" };
    const result = run(sandbox(), { pilot: sandboxNamedPilot });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("vars.SANDBOX_WORKERS");
  });

  it("refuses a D1 id equal to the pilot's", () => {
    const result = run(withD1({ database_id: PILOT_DB_ID }));
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("d1_databases.database_id");
  });

  it("refuses a bucket named like a pilot bucket", () => {
    const result = run(sandbox({ r2_buckets: [{ binding: "RECEIPTS", bucket_name: "fixture-pilot-bucket" }] }));
    expect(result.ok).toBe(false);
  });

  it("refuses a ratelimit namespace id equal to the pilot's, as string or number", () => {
    for (const namespace_id of ["4242", 4242]) {
      const result = run(sandbox({ ratelimits: [{ name: "LOGIN_LIMITER", namespace_id }] }));
      expect(result.ok).toBe(false);
      expect(fields(result)).toContain("ratelimits.namespace_id");
    }
  });

  it("refuses an id found only in .pilot-resources.json", () => {
    const result = run(sandbox({ ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "5555" }] }), { extraDenylist: { ids: ["5555"] } });
    expect(result.ok).toBe(false);
  });

  it("fails closed when no real pilot data is known (only placeholders or none)", () => {
    for (const extra of [{ pilot: null }, { pilot: { name: "example-name" } }, { pilot: {}, extraDenylist: { names: ["<pilot-name>"], ids: ["0000"] } }]) {
      const result = run(sandbox(), extra);
      expect(result.ok).toBe(false);
      expect(fields(result)).toContain("pilot");
    }
  });

  it("fails closed on a missing or non-object target", () => {
    for (const target of [null, undefined, "x", []]) expect(run(target).ok).toBe(false);
  });

  it("never prints names or ids in violations", () => {
    const result = run(withD1({ database_id: PILOT_DB_ID }));
    const text = JSON.stringify(result);
    expect(text).not.toContain(PILOT_DB_ID);
    expect(text).not.toContain("fixture-pilot");
  });
});

describe("checkSandboxConfig: allowlist of top-level keys", () => {
  it.each([
    ["services", [{ binding: "X", service: "other-sandbox" }]],
    ["durable_objects", { bindings: [{ name: "X", class_name: "C", script_name: "rekauda-sandbox-x" }] }],
    ["kv_namespaces", [{ binding: "K", id: "deadbeef" }]],
    ["queues", { producers: [{ queue: "q", binding: "Q" }] }],
    ["vectorize", [{ binding: "V", index_name: "i" }]],
    ["hyperdrive", [{ binding: "H", id: "x" }]],
    ["analytics_engine_datasets", [{ binding: "A" }]],
    ["tail_consumers", [{ service: "rekauda-sandbox-tail" }]],
    ["triggers", { crons: ["* * * * *"] }],
    ["build", { command: "echo hi" }],
    ["routes", []],
    ["route", "x.example.net/*"],
    ["env", {}],
    ["send_email", [{ name: "SEND_EMAIL" }]],
    ["unsafe", { bindings: [] }],
    ["tsconfig", "x"],
    ["dev", { port: 1 }],
    ["limits", { cpu_ms: 1 }],
    ["placement", { mode: "smart" }],
  ])("refuses the top-level key %s", (key, value) => {
    const result = run(sandbox({ [key]: value }));
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain(key);
  });

  it("accepts every allowed key of the example shape", () => {
    expect(run(sandbox({ compatibility_date: "2026-11-25", compatibility_flags: ["nodejs_compat"], assets: { binding: "ASSETS" }, images: { binding: "IMAGES" }, observability: { enabled: true }, rules: [] })).ok).toBe(true);
  });
});

describe("checkSandboxConfig: complete pilot knowledge (H1)", () => {
  const sbWithPilotD1 = () => withD1({ database_id: PILOT_DB_ID });
  it("refuses partial pilot data: only a worker name (the sandbox D1 id could be the pilot's)", () => {
    for (const extra of [{ pilot: { name: "fixture-pilot" } }, { pilot: null, extraDenylist: { names: ["fixture-pilot"] } }]) {
      const result = run(sbWithPilotD1(), extra);
      expect(result.ok).toBe(false);
      expect(fields(result)).toContain("pilot");
    }
  });

  it.each([
    ["no worker name", { d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"] }],
    ["no D1 id", { workers: ["fixture-pilot"], buckets: ["fixture-pilot-bucket"] }],
    ["no bucket", { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID] }],
    ["a D1 id that is not UUID shaped", { workers: ["fixture-pilot"], d1Ids: ["not-a-uuid"], buckets: ["fixture-pilot-bucket"] }],
    ["only flat names and ids that cannot be classified", { names: ["fixture-pilot", "fixture-pilot-bucket"], ids: ["4242"] }],
  ])("refuses an incomplete .pilot-resources.json: %s", (_label, extraDenylist) => {
    const result = run(sandbox(), { pilot: null, extraDenylist });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("pilot");
  });

  it("counts a UUID in the flat ids list as the D1 id", () => {
    expect(run(sandbox(), { pilot: null, extraDenylist: { workers: ["fixture-pilot"], buckets: ["fixture-pilot-bucket"], ids: [PILOT_DB_ID] } }).ok).toBe(true);
  });

  it("does not count example values or placeholders as real categories", () => {
    const onlyExample = { name: "example-name", d1_databases: [{ database_name: "example-db", database_id: "00000000-0000-0000-0000-000000000000" }], r2_buckets: [{ bucket_name: "example-bucket" }] };
    const exampleWithBucket = { ...pilotExample, r2_buckets: [{ bucket_name: "example-bucket" }] };
    const result = checkSandboxConfig({ target: sandbox(), targetFile: "wrangler.sandbox.jsonc", pilot: onlyExample, pilotExample: exampleWithBucket });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["an unknown key", { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"], extra: ["x"] }],
    ["a value that is not a list", { workers: "fixture-pilot", d1Ids: [PILOT_DB_ID], buckets: ["fixture-pilot-bucket"] }],
    ["an entry of the wrong type", { workers: ["fixture-pilot"], d1Ids: [PILOT_DB_ID, { id: 1 }], buckets: ["fixture-pilot-bucket"] }],
  ])("refuses a malformed .pilot-resources.json: %s", (_label, extraDenylist) => {
    const result = run(sandbox(), { pilot: null, extraDenylist });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("pilot");
  });

  it("refuses a non-object .pilot-resources.json", () => {
    for (const extraDenylist of ["x", 5, ["a"]]) expect(run(sandbox(), { extraDenylist }).ok).toBe(false);
  });
});

describe("checkSandboxConfig: id comparison is exact in every spelling", () => {
  it("M1: refuses a ratelimit id equal to the pilot's even when the pilot example has the same value", () => {
    const sharedExample = { ...pilotExample, ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "4242" }] };
    const result = checkSandboxConfig({ target: sandbox({ ratelimits: [{ name: "LOGIN_LIMITER", namespace_id: "4242" }] }), targetFile: "wrangler.sandbox.jsonc", pilot, pilotExample: sharedExample });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("ratelimits.namespace_id");
  });

  it.each([
    ["without hyphens", PILOT_DB_ID.replaceAll("-", "")],
    ["in braces", `{${PILOT_DB_ID}}`],
    ["uppercase with spaces", `  ${PILOT_DB_ID.toUpperCase()} `],
    ["braces without hyphens", `{${PILOT_DB_ID.replaceAll("-", "")}}`],
  ])("M2: refuses a D1 id equal to the pilot's %s", (_label, id) => {
    expect(run(withD1({ database_id: id })).ok).toBe(false);
  });

  it("M2: refuses the pilot account id spelled differently outside account_id", () => {
    const hexAccount = "0123456789abcdef0123456789abcdef";
    const result = run(withVars({ NOTE: hexAccount.toUpperCase() }), { pilot: { ...pilot, account_id: hexAccount } });
    expect(result.ok).toBe(false);
  });

  it("refuses a full-width spelling of a pilot name (compatibility normalization)", () => {
    expect(run(withVars({ NOTE: "\uFF46ixture-pilot" })).ok).toBe(false);
  });

  it("refuses the pilot D1 id in a nested field and in a second entry", () => {
    expect(run(withVars({ nested: { deep: [PILOT_DB_ID] } })).ok).toBe(false);
  });

  it("refuses the pilot account id nested under another key", () => {
    expect(run(withVars({ x: { account_id: PILOT_ACCOUNT } })).ok).toBe(false);
  });
});

describe("account_id exception does not weaken cloud mode", () => {
  it("still refuses an account_id equal to the pilot's in cloud config", () => {
    const target = { name: "cloud-fresh", account_id: PILOT_ACCOUNT, d1_databases: [{ migrations_dir: "migrations-cloud" }] };
    const result = checkCloudConfig({ target, pilot, pilotExample, mode: "local" });
    expect(result.ok).toBe(false);
    expect(fields(result)).toContain("account_id");
  });

  it("still refuses any remote mode for the cloud config", () => {
    const target = { name: "cloud-fresh", d1_databases: [{ database_id: SANDBOX_DB_ID, migrations_dir: "migrations-cloud" }] };
    expect(checkCloudConfig({ target, pilot, pilotExample, mode: "remote" }).ok).toBe(false);
  });
});
