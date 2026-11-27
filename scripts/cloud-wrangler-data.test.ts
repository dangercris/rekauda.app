import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "./lib/jsonc.mjs";
import example from "../rekauda.config.example";
import { SLUG, makePilotWorld } from "./lib/import/pilot-world";
import { TENANT_ID } from "./lib/import/pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { productionRemote, runCloudWrangler } from "./lib/cloud-wrangler-core.mjs";

// Production data commands (import). The fake spawn answers like wrangler would, from an in-memory Cloud database.
const ROOT_DOMAIN = "colegio-demo.example.test";
const PROD_CONFIG = ["--config", "wrangler.production.jsonc"];
const prodConfig = (patch: Record<string, unknown> = {}): string => {
  const example = parseJsonc(readFileSync(new URL("../wrangler.production.example.jsonc", import.meta.url), "utf8"));
  const ratelimits = example.ratelimits.map((r: any, i: number) => ({ ...r, namespace_id: String(7001 + i) }));
  return JSON.stringify({ ...example, d1_databases: [{ ...example.d1_databases[0], database_id: "55555555-aaaa-bbbb-cccc-444444444444" }], ratelimits, ...patch });
};
const PILOT_REF = JSON.stringify({ workers: ["fixture-pilot-worker"], d1Ids: ["11111111-aaaa-bbbb-cccc-222222222222"], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"], productionRoot: ROOT_DOMAIN });

interface Call { bin: string; argv: string[]; cwd: string; env: Record<string, string>; stdio: unknown }

function setup(opts: Parameters<typeof makePilotWorld>[0] = {}) {
  const w = makePilotWorld({ ...opts, extraFiles: { "wrangler.production.jsonc": prodConfig(), ".pilot-resources.json": PILOT_REF } });
  const calls: Call[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const asked: string[] = [];
  const state = { onCall: undefined as undefined | ((call: Call) => void), typed: undefined as string | undefined, tty: true, notesAtAsk: -1 };
  const spawn = (bin: string, argv: string[], options: { cwd: string; env: Record<string, string>; stdio: unknown }) => {
    const call = { bin, argv, cwd: options.cwd, env: options.env, stdio: options.stdio };
    calls.push(call);
    state.onCall?.(call);
    if (argv[0] === "r2") return { status: 0, stdout: "" };
    const at = argv.indexOf("--command");
    if (at !== -1) return { status: 0, stdout: JSON.stringify([{ success: true, results: w.cloud.sqlite.prepare(argv[at + 1]!).all() }]) };
    w.cloud.sqlite.exec(readFileSync(argv[argv.indexOf("--file") + 1]!, "utf8"));
    return { status: 0, stdout: "[]" };
  };
  const log = { error: (m: string) => errors.push(String(m)), warn: (m: string) => notes.push(String(m)), log: (m: string) => notes.push(String(m)) };
  const confirm = (phrase: string) => {
    asked.push(phrase);
    state.notesAtAsk = notes.length;
    return state.tty && state.typed === phrase;
  };
  const run = (sub: string, args: string[], typed?: string, env: Record<string, string> = { PATH: "/bin", CLOUDFLARE_API_TOKEN: "tok-secret-1", SOMETHING_ELSE: "x" }) => {
    state.typed = typed;
    return runCloudWrangler([sub, ...args], { root: w.root + "/", bin: "w", viteBin: "v", spawn, log, env, confirm, tmp: w.tmp }) as number;
  };
  return { ...w, calls, errors, notes, asked, state, run };
}

describe("prod:import through the wrapper", () => {
  it("prints worker, account and root, then needs IMPORT <slug>, then runs only the fixed reads and the plan file", () => {
    const w = setup();
    expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(0);
    expect(w.asked).toEqual([`IMPORT ${SLUG}`]);
    expect(w.state.notesAtAsk).toBe(1);
    expect(w.notes[0]).toMatch(new RegExp(`prod:import: worker=\\S+ account=.+ root=${ROOT_DOMAIN}`));
    const reads = w.calls.slice(0, -1);
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (const call of reads) {
      expect(call.argv.slice(0, 5)).toEqual(["d1", "execute", "DB", "--remote", "--json"]);
      expect(call.argv.slice(5, 7)).toEqual(PROD_CONFIG);
      expect(call.argv[7]).toBe("--command");
      expect(call.argv[8]).toMatch(/^SELECT [^;]*;$/);
      expect(call.argv).toHaveLength(9);
    }
    const last = w.calls.at(-1)!.argv;
    expect(last.slice(0, 8)).toEqual(["d1", "execute", "DB", "--remote", "--json", ...PROD_CONFIG, "--file"]);
    expect(last[8]).toMatch(new RegExp(`^${w.dir}/run-[A-Za-z0-9]+/import\\.sql$`));
    expect(last).toHaveLength(9);
    expect(w.count("payments")).toBe(3);
  });

  it("spawns with the checkout as cwd, a scrubbed env and no terminal output", () => {
    const w = setup();
    w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`);
    for (const call of w.calls) {
      expect(call.cwd).toBe(w.root + "/");
      expect(Object.keys(call.env).sort()).toEqual(["CLOUDFLARE_API_TOKEN", "PATH"]);
      expect(call.stdio).toEqual(["ignore", "pipe", "pipe"]);
    }
    expect([...w.notes, ...w.errors].join("\n")).not.toMatch(/tok-secret-1|Familia|Alumno|0990000000|INSERT/);
  });

  it("spawns nothing without the exact phrase or a terminal", () => {
    for (const [typed, tty] of [["IMPORT other-demo", true], ["import curso-demo", true], [`IMPORT ${SLUG}`, false], [undefined, true]] as const) {
      const w = setup();
      w.state.tty = tty;
      expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], typed)).toBe(1);
      expect(w.calls).toEqual([]);
    }
  });

  it.each([
    ["no arguments", []],
    ["a missing slug", ["DIR", TENANT_ID]],
    ["an extra argument", ["DIR", TENANT_ID, SLUG, "extra"]],
    ["a passthrough flag", ["DIR", TENANT_ID, "--remote"]],
    ["a tenant id that is not a UUID", ["DIR", "curso-demo", SLUG]],
    ["a slug that is not a slug", ["DIR", TENANT_ID, "Curso Demo"]],
    ["a directory that is not a workdir", ["/nowhere", TENANT_ID, SLUG]],
  ])("refuses %s before asking or spawning", (_name, args) => {
    const w = setup();
    expect(w.run("prod:import", args.map((a) => (a === "DIR" ? w.dir : a)), `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls).toEqual([]);
    expect(w.asked).toEqual([]);
  });

  it("refuses when the production config is missing or invalid, spawning nothing", () => {
    const w = setup();
    writeFileSync(join(w.root, "wrangler.production.jsonc"), prodConfig({ name: "not-prefixed" }));
    expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls).toEqual([]);
  });

  it("re-runs the guard before every spawn: a config that changes midway stops the import before the file", () => {
    const w = setup();
    w.state.onCall = () => writeFileSync(join(w.root, "wrangler.production.jsonc"), prodConfig({ name: "rekauda-cloud-other" }));
    expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls).toHaveLength(1);
    expect(w.count("collections")).toBe(0);
  });

  it("gives a generic refusal, not a stack trace, for a missing or unparseable production config", () => {
    for (const content of [undefined, "{ not json"]) {
      const w = setup();
      if (content === undefined) rmSync(join(w.root, "wrangler.production.jsonc"));
      else writeFileSync(join(w.root, "wrangler.production.jsonc"), content);
      expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
      expect(w.calls).toEqual([]);
      expect(w.errors.join("\n")).toMatch(/production config could not be read/);
      expect(w.errors.join("\n")).not.toMatch(/ENOENT|SyntaxError|at /);
    }
  });

  it("a config that becomes unreadable midway stops the import cleanly before the file", () => {
    const w = setup();
    w.state.onCall = () => rmSync(join(w.root, "wrangler.production.jsonc"));
    expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls).toHaveLength(1);
  });

  it("does not execute when the target is not clean (a tenant with the wrong source)", () => {
    const w = setup({ tenant: { slug: SLUG, source: "cloud" } });
    expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls.some((c) => c.argv.includes("--file"))).toBe(false);
  });

  it("refuses a stale plan before any remote call", () => {
    const w = setup({ plan: false });
    expect(w.run("prod:import", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls).toEqual([]);
  });
});

describe("prod:validate, prod:undo-data and prod:undo-tenant through the wrapper", () => {
  const withRows = () => {
    const w = setup();
    w.cloud.sqlite.exec(readFileSync(join(w.dir, "import.sql"), "utf8"));
    return w;
  };

  it("prod:validate asks VALIDATE <slug>, then only reads, and prints MATCH", () => {
    const w = withRows();
    expect(w.run("prod:validate", [w.dir, TENANT_ID, SLUG], `VALIDATE ${SLUG}`)).toBe(0);
    expect(w.asked).toEqual([`VALIDATE ${SLUG}`]);
    expect(w.state.notesAtAsk).toBe(1);
    expect(w.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of w.calls) {
      expect(call.argv.slice(0, 7)).toEqual(["d1", "execute", "DB", "--remote", "--json", ...PROD_CONFIG]);
      expect(call.argv[7]).toBe("--command");
      expect(call.argv[8]).toMatch(/^SELECT [^;]*;$/);
    }
    expect(w.notes.join("\n")).toContain("MATCH");
    expect([...w.notes, ...w.errors].join("\n")).not.toMatch(/Familia|Alumno|0990000000/);
  });

  it("prod:validate exits non-zero on a mismatch", () => {
    const w = withRows();
    w.cloud.sqlite.exec("UPDATE payments SET amount_cents = 1 WHERE id = 'pay-1'");
    expect(w.run("prod:validate", [w.dir, TENANT_ID, SLUG], `VALIDATE ${SLUG}`)).not.toBe(0);
    expect(w.errors.join("\n")).toContain("MISMATCH");
  });

  it.each([
    ["prod:undo-data", "UNDO DATA", ["bank_movements", "students", "payments", "collections"]],
    ["prod:undo-tenant", "UNDO TENANT", ["bank_movements", "students", "payments", "collections", "sessions", "magic_links", "memberships", "tenant_domains", "tenants"]],
  ])("%s asks %s <slug>, then runs only single DELETE statements for the tenant", (sub, phrase, order) => {
    const w = withRows();
    expect(w.run(sub, [w.dir, TENANT_ID, SLUG], `${phrase} ${SLUG}`)).toBe(0);
    expect(w.asked).toEqual([`${phrase} ${SLUG}`]);
    const deletes = w.calls.filter((c) => c.argv[8]?.startsWith("DELETE"));
    expect(deletes.map((c) => /^DELETE FROM (\w+)/.exec(c.argv[8]!)![1])).toEqual(order);
    for (const call of deletes) {
      expect(call.argv.slice(0, 8)).toEqual(["d1", "execute", "DB", "--remote", "--json", ...PROD_CONFIG, "--command"]);
      expect(call.argv[8]!.slice(0, -1)).not.toContain(";");
      expect(call.argv[8]).toContain(TENANT_ID);
    }
    for (const call of w.calls.filter((c) => !c.argv[8]?.startsWith("DELETE"))) expect(call.argv[8]).toMatch(/^SELECT /);
    expect(w.count("payments")).toBe(0);
  });

  it.each(["prod:undo-data", "prod:undo-tenant"])("%s needs the workdir, the exact phrase, a terminal and valid ids, spawning nothing otherwise", (sub) => {
    const w = withRows();
    expect(w.run(sub, [TENANT_ID, SLUG], "x")).toBe(1);
    expect(w.run(sub, [w.dir, TENANT_ID, "Bad Slug"], "x")).toBe(1);
    expect(w.run(sub, ["nope", TENANT_ID, SLUG], "x")).toBe(1);
    expect(w.run(sub, [w.dir, TENANT_ID, SLUG], "UNDO DATA other-demo")).toBe(1);
    w.state.tty = false;
    expect(w.run(sub, [w.dir, TENANT_ID, SLUG], `UNDO DATA ${SLUG}`)).toBe(1);
    expect(w.calls).toEqual([]);
    expect(w.count("payments")).toBe(3);
  });

  it("an undo after parents created new data is refused and deletes nothing", () => {
    const w = withRows();
    w.addCollection(TENANT_ID, "created-later", "nuevo-demo");
    expect(w.run("prod:undo-data", [w.dir, TENANT_ID, SLUG], `UNDO DATA ${SLUG}`)).toBe(1);
    expect(w.calls.some((c) => c.argv[8]?.startsWith("DELETE"))).toBe(false);
    expect(w.count("payments")).toBe(3);
  });

  it("the typed phrases are not interchangeable between data, tenant and import", () => {
    const w = withRows();
    expect(w.run("prod:undo-tenant", [w.dir, TENANT_ID, SLUG], `UNDO DATA ${SLUG}`)).toBe(1);
    expect(w.run("prod:undo-data", [w.dir, TENANT_ID, SLUG], `IMPORT ${SLUG}`)).toBe(1);
    expect(w.calls).toEqual([]);
  });
});

describe("productionRemote hands out only the methods it is asked for", () => {
  const make = (methods: string[]) => productionRemote({ root: "/x/", bin: "w", spawn: () => ({ status: 1 }), env: {}, log: console, checkFn: () => ({ result: { ok: true, warnings: [], violations: [] }, target: {} }), target: {}, methods });
  it.each([[["select", "file"]], [["select"]], [["select", "mutate"]], [["select", "insert", "put"]]])("%j", (methods) => {
    expect(Object.keys(make(methods)).sort()).toEqual([...methods].sort());
  });
});

describe("mutate enforces the scoping at the chokepoint", () => {
  const UUID_A = "c0000000-0000-4000-8000-0000000000c1";
  const ok = `DELETE FROM payments WHERE tenant_id = '${UUID_A}' AND EXISTS (SELECT 1 FROM tenants WHERE id = '${UUID_A}' AND source = 'pilot_import');`;
  const run = (sql: string) => {
    const seen: string[][] = [];
    const remote = productionRemote({ root: "/x/", bin: "w", spawn: (_b: string, argv: string[]) => (seen.push(argv), { status: 0, stdout: "[]" }), env: {}, log: console, checkFn: () => ({ result: { ok: true, warnings: [], violations: [] }, target: {} }), target: {}, methods: ["mutate"] });
    return { call: () => remote.mutate(sql), seen };
  };
  it("sends a scoped DELETE", () => {
    const { call, seen } = run(ok);
    call();
    expect(seen).toHaveLength(1);
  });
  it.each([
    ["no scope", "DELETE FROM tenants WHERE 1=1;"],
    ["no UUID literal", "DELETE FROM payments WHERE tenant_id = 'x' AND source = 'pilot_import';"],
    ["no pilot_import guard", `DELETE FROM payments WHERE tenant_id = '${UUID_A}';`],
    ["a table that is not allowed", ok.replace("payments", "sqlite_master")],
    ["two statements", ok + " " + ok],
    ["an UPDATE", ok.replace("DELETE FROM", "UPDATE")],
  ])("refuses %s without spawning", (_n, sql) => {
    const { call, seen } = run(sql);
    expect(call).toThrow();
    expect(seen).toEqual([]);
  });
});

describe("prod:provision through the wrapper", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const provisioning = (over: Record<string, unknown> = {}, content?: string) => {
    const w = setup({ plan: false, tenant: null, provisioned: false });
    const qrPath = join(w.tmp, "qr-source.png");
    writeFileSync(qrPath, PNG);
    writeFileSync(join(w.dir, "tenant.json"), content ?? JSON.stringify({ slug: SLUG, ownerEmail: "owner@example.test", config: JSON.parse(JSON.stringify(example)), qrPath, ...over }), { mode: 0o600 });
    chmodSync(join(w.dir, "tenant.json"), 0o600);
    return w;
  };

  it("prints worker, account and root, then needs PROVISION <slug>, then runs reads, one fixed QR upload, four INSERTs and a read-back", () => {
    const w = provisioning();
    expect(w.run("prod:provision", [w.dir], `PROVISION ${SLUG}`)).toBe(0);
    expect(w.asked).toEqual([`PROVISION ${SLUG}`]);
    expect(w.state.notesAtAsk).toBe(1);
    expect(w.notes[0]).toMatch(new RegExp(`prod:provision: worker=\\S+ account=.+ root=${ROOT_DOMAIN} tenant=[0-9a-f-]{36} slug=${SLUG}`));
    const id = /tenant=([0-9a-f-]{36})/.exec(w.notes[0]!)![1]!;
    const put = w.calls.filter((c) => c.argv[0] === "r2");
    expect(put).toHaveLength(1);
    expect(put[0]!.argv).toEqual(["r2", "object", "put", `rekauda-cloud-files/t/${id}/assets/deuna-qr.png`, "--file", expect.stringMatching(/\/qr-[A-Za-z0-9]+\/deuna-qr\.png$/), "--content-type", "image/png", "--remote", ...PROD_CONFIG]);
    const sql = w.calls.filter((c) => c.argv[0] === "d1").map((c) => c.argv[8]!);
    expect(sql.filter((q) => q.startsWith("INSERT INTO")).map((q) => /^INSERT INTO (\w+)/.exec(q)![1])).toEqual(["tenants", "tenant_domains", "users", "memberships"]);
    expect(sql.every((q) => q.startsWith("INSERT INTO") || q.startsWith("SELECT "))).toBe(true);
    expect(w.calls.indexOf(put[0]!)).toBeLessThan(w.calls.findIndex((c) => c.argv[8]?.startsWith("INSERT")));
    expect(w.cloud.sqlite.prepare("SELECT source, qr_key FROM tenants").get()).toEqual({ source: "pilot_import", qr_key: `t/${id}/assets/deuna-qr.png` });
  });

  it("spawns with the checkout as cwd, a scrubbed env and no secret in the output", () => {
    const w = provisioning();
    w.run("prod:provision", [w.dir], `PROVISION ${SLUG}`);
    for (const call of w.calls) {
      expect(call.cwd).toBe(w.root + "/");
      expect(Object.keys(call.env).sort()).toEqual(["CLOUDFLARE_API_TOKEN", "PATH"]);
      expect(call.stdio).toEqual(["ignore", "pipe", "pipe"]);
    }
    const handover = readFileSync(join(w.dir, "handover.txt"), "utf8").trim();
    expect(statSync(join(w.dir, "handover.txt")).mode & 0o777).toBe(0o600);
    expect([...w.notes, ...w.errors].join("\n")).not.toMatch(new RegExp(`tok-secret-1|${handover.slice(2, 34)}|owner@example|in\\.${ROOT_DOMAIN}`));
  });

  it("spawns nothing without the exact phrase or a terminal", () => {
    for (const [typed, tty] of [["PROVISION other-demo", true], ["provision curso-demo", true], [`PROVISION ${SLUG}`, false], [undefined, true]] as const) {
      const w = provisioning();
      w.state.tty = tty;
      expect(w.run("prod:provision", [w.dir], typed)).toBe(1);
      expect(w.calls).toEqual([]);
    }
  });

  it.each([
    ["no arguments", []],
    ["a tenant id and slug (the id is generated)", ["DIR", "c0000000-0000-4000-8000-0000000000c1", SLUG]],
    ["a passthrough flag", ["DIR", "--remote"]],
    ["a directory that is not a workdir", ["/nowhere"]],
  ])("refuses %s before asking or spawning", (_name, args) => {
    const w = provisioning();
    expect(w.run("prod:provision", args.map((a) => (a === "DIR" ? w.dir : a)), `PROVISION ${SLUG}`)).toBe(1);
    expect(w.calls).toEqual([]);
    expect(w.asked).toEqual([]);
  });

  it("refuses an invalid tenant.json or QR before asking or spawning, without echoing values", () => {
    for (const w of [provisioning({}, "{ nope"), provisioning({ ownerEmail: "bad" }), provisioning({ qrPath: "/nowhere/qr.png" })]) {
      expect(w.run("prod:provision", [w.dir], `PROVISION ${SLUG}`)).toBe(1);
      expect(w.calls).toEqual([]);
      expect(w.asked).toEqual([]);
      expect(w.errors.join("\n")).not.toMatch(/bad|nowhere|nope/);
    }
  });

  it("re-runs the guard before every spawn: a config that changes midway stops it before the QR upload and the writes", () => {
    const w = provisioning();
    w.state.onCall = () => writeFileSync(join(w.root, "wrangler.production.jsonc"), prodConfig({ name: "rekauda-cloud-other" }));
    expect(w.run("prod:provision", [w.dir], `PROVISION ${SLUG}`)).toBe(1);
    expect(w.calls).toHaveLength(1);
    expect(w.cloud.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 0 });
  });

  it("the next step, pilot:import:plan, reads the tenant id from the manifest this run wrote", () => {
    const w = provisioning();
    expect(w.run("prod:provision", [w.dir], `PROVISION ${SLUG}`)).toBe(0);
    const id = /tenant=([0-9a-f-]{36})/.exec(w.notes[0]!)![1]!;
    expect(JSON.parse(readFileSync(join(w.dir, "manifest.json"), "utf8")).tenant).toEqual({ id, slug: SLUG });
  });
});

describe("insert enforces the INSERT-only scoping at the chokepoint", () => {
  const ID = "c0000000-0000-4000-8000-0000000000c1";
  const tenants = `INSERT INTO tenants (id, slug, config_json, r2_prefix, source, qr_key, inbound_token_hash, created_at, updated_at) VALUES ('${ID}', 'curso-demo', '{"a":"x; y -- z"}', 't/${ID}/', 'pilot_import', NULL, NULL, 'n', 'n');`;
  const members = `INSERT INTO memberships (tenant_id, user_id, role, created_at) SELECT '${ID}', id, 'owner', 'n' FROM users WHERE email = 'o@example.test' AND kind = 'person';`;
  const run = (sql: string) => {
    const seen: string[][] = [];
    const remote = productionRemote({ root: "/x/", bin: "w", spawn: (_b: string, argv: string[]) => (seen.push(argv), { status: 0, stdout: "[]" }), env: {}, log: console, checkFn: () => ({ result: { ok: true, warnings: [], violations: [] }, target: {} }), target: {}, methods: ["insert"] });
    return { call: () => remote.insert(sql), seen };
  };
  it.each([["a tenant row with semicolons and dashes inside a literal", tenants], ["the membership select", members]])("sends %s", (_n, sql) => {
    const { call, seen } = run(sql);
    call();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.slice(-2)).toEqual(["--command", sql]);
  });
  it.each([
    ["a DELETE", tenants.replace("INSERT INTO", "DELETE FROM")],
    ["an UPDATE", tenants.replace("INSERT INTO", "UPDATE")],
    ["a table that is not allowed", tenants.replace("INTO tenants", "INTO payments")],
    ["no tenant UUID literal", tenants.replaceAll(ID, "x")],
    ["a tenant that is not pilot_import", tenants.replace("'pilot_import'", "'cloud'")],
    ["two statements", tenants + " " + members],
    ["a statement after an unbalanced quote", tenants.replace("'n');", "'n'); DROP TABLE users; --'")],
    ["a trailing comment", tenants + " -- x"],
    ["no terminating semicolon", tenants.slice(0, -1)],
  ])("refuses %s without spawning", (_n, sql) => {
    const { call, seen } = run(sql);
    expect(call).toThrow();
    expect(seen).toEqual([]);
  });
});

describe("put is the one fixed R2 upload of the QR", () => {
  const ID = "c0000000-0000-4000-8000-0000000000c1";
  const target = { r2_buckets: [{ binding: "RECEIPTS", bucket_name: "rekauda-cloud-files" }, { binding: "MAIL_ARCHIVE", bucket_name: "rekauda-cloud-mail" }] };
  const run = (spec: Record<string, unknown>, t: unknown = target) => {
    const seen: string[][] = [];
    const remote = productionRemote({ root: "/x/", bin: "w", spawn: (_b: string, argv: string[]) => (seen.push(argv), { status: 0, stdout: "" }), env: {}, log: console, checkFn: () => ({ result: { ok: true, warnings: [], violations: [] }, target: t }), target: t, methods: ["put"] });
    return { call: () => remote.put(spec), seen };
  };
  const good = { tenantId: ID, ext: "webp", contentType: "image/webp", file: "/w/qr-abc/deuna-qr.webp" };
  it("uploads to the receipts bucket under the tenant prefix only", () => {
    const { call, seen } = run(good);
    call();
    expect(seen).toEqual([["r2", "object", "put", `rekauda-cloud-files/t/${ID}/assets/deuna-qr.webp`, "--file", good.file, "--content-type", "image/webp", "--remote", ...PROD_CONFIG]]);
  });
  it.each([
    ["a tenant id that is not a UUID", { ...good, tenantId: "../x" }],
    ["an extension that is not allowed", { ...good, ext: "svg", file: "/w/qr-abc/deuna-qr.svg", contentType: "image/svg+xml" }],
    ["a content type that does not match the extension", { ...good, contentType: "text/html" }],
    ["a file that is not the staged deuna-qr file", { ...good, file: "/w/qr-abc/other.webp" }],
    ["a flag-like file path", { ...good, file: "--x/deuna-qr.webp" }],
  ])("refuses %s without spawning", (_n, spec) => {
    const { call, seen } = run(spec);
    expect(call).toThrow();
    expect(seen).toEqual([]);
  });
  it("refuses when the checked config has no RECEIPTS bucket", () => {
    const { call, seen } = run(good, { r2_buckets: [{ binding: "MAIL_ARCHIVE", bucket_name: "rekauda-cloud-mail" }] });
    expect(call).toThrow();
    expect(seen).toEqual([]);
  });
});
