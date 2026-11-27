import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./fake-checkout";
// @ts-expect-error plain .mjs module without types
import { EXPORT_PHRASE, EXPORT_STATEMENTS, SELECT_BATCH, runPilotCleanup, runPilotExport } from "./pilot-export.mjs";

// Invented fixtures only. The fake checkout holds a stand-in for the local pilot reference; real wrangler is never reachable.
const ACCOUNT = "acct-fixture-0001";
const PILOT = {
  name: "fixture-pilot",
  account_id: ACCOUNT,
  d1_databases: [{ binding: "DB", database_name: "fixture-pilot-db", database_id: "11111111-aaaa-bbbb-cccc-222222222222" }],
  r2_buckets: [{ binding: "RECEIPTS", bucket_name: "fixture-pilot-bucket" }],
};
const ROWS = {
  collections: [{ id: "col-1", slug: "curso-demo", title: "Curso Demo" }],
  payments: [{ id: "pay-1", parent_name: "Ana Demo", amount_cents: 1500, collection_id: "col-1" }],
  students: [{ id: 1, payment_id: "pay-1", given_names: "Luis", surnames: "Demo" }],
  bank_movements: [{ id: "mov-1", amount_cents: 1500, payment_id: "pay-1" }],
};
const tables = Object.keys(ROWS) as (keyof typeof ROWS)[];
const stdoutOf = (rows: Record<string, unknown[]>, meta = 1): string => JSON.stringify(tables.map((t) => ({ results: rows[t], success: true, meta: { duration: meta } })));

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

interface Call { bin: string; argv: string[]; cwd: string; env: Record<string, string | undefined>; options: Record<string, unknown> }

function setup(files: Record<string, string> = { "wrangler.jsonc": JSON.stringify(PILOT) }) {
  const root = fakeCheckout("pilot-export", files);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pilot-export-tmp-")));
  dirs.push(root, tmp);
  const calls: Call[] = [];
  const out: string[] = [];
  const asked: string[] = [];
  const state = { stdout: stdoutOf(ROWS), status: 0, typed: EXPORT_PHRASE as string | undefined };
  const spawn = (bin: string, argv: string[], options: any) => {
    calls.push({ bin, argv, cwd: options.cwd, env: options.env, options });
    return { status: state.status, stdout: state.stdout, stderr: "secret stderr row Ana Demo" };
  };
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const confirm = (phrase: string) => (asked.push(phrase), state.typed === phrase);
  const env = { PATH: "/bin", HOME: "/home/x", CLOUDFLARE_API_TOKEN: "tok-secret-1", CLOUDFLARE_ACCOUNT_ID: "other-account", CLOUDFLARE_ENV: "x", WRANGLER_SEND_METRICS: "1" };
  const run = (...args: string[]) => runPilotExport(args, { root: root + "/", bin: "fake-wrangler", spawn, log, env, confirm, tmp, now: () => "2026-11-27T00:00:00.000Z" }) as number;
  return { root, tmp, calls, out, asked, state, run };
}
const workdirs = (tmp: string) => readdirSync(tmp).filter((n) => n.startsWith("rekauda-pilot-"));

describe("the fixed SQL", () => {
  it("is exactly four SELECT statements, one per table, joined into one batch", () => {
    expect(EXPORT_STATEMENTS).toHaveLength(4);
    for (const sql of EXPORT_STATEMENTS) expect(sql).toMatch(/^SELECT \* FROM (collections|payments|students|bank_movements) ORDER BY id;$/);
    expect(SELECT_BATCH).toBe(EXPORT_STATEMENTS.join(" "));
  });
});

describe("pilot:export: what it runs", () => {
  it("spawns exactly one fixed argv with no config, from the private workdir, with a scrubbed env", () => {
    const { calls, tmp, run, root } = setup();
    expect(run()).toBe(0);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.argv).toEqual(["d1", "execute", "fixture-pilot-db", "--remote", "--json", "--command", SELECT_BATCH]);
    expect(call!.bin).toBe("fake-wrangler");
    expect(call!.cwd).toBe(join(tmp, workdirs(tmp)[0]!));
    expect(call!.cwd.startsWith(root)).toBe(false);
    expect(call!.env).toEqual({ PATH: "/bin", HOME: "/home/x", CLOUDFLARE_API_TOKEN: "tok-secret-1", CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
    expect((call!.options.stdio as string[])[1]).toBe("pipe");
  });

  it.each([["--command", "DELETE FROM payments"], ["--file", "x.sql"], ["other-db"], ["--remote"], ["a", "b"]])("rejects extra args %j without touching wrangler or asking", (...args) => {
    const { calls, asked, tmp, run } = setup();
    expect(run(...args)).toBe(1);
    expect([calls, asked, workdirs(tmp)]).toEqual([[], [], []]);
  });

  it("runs nothing and creates nothing without the typed phrase", () => {
    const { calls, asked, tmp, state, run } = setup();
    state.typed = "yes";
    expect(run()).toBe(1);
    expect(asked).toEqual([EXPORT_PHRASE]);
    expect([calls, workdirs(tmp)]).toEqual([[], []]);
  });

  it.each([
    ["no pilot reference file", {}],
    ["placeholders only", { "wrangler.jsonc": JSON.stringify({ name: "<worker>", account_id: "<id>", d1_databases: [{ database_name: "<db>", database_id: "00000000-0000-0000-0000-000000000000" }], r2_buckets: [{ bucket_name: "<bucket>" }] }) }],
    ["no account id", { "wrangler.jsonc": JSON.stringify({ ...PILOT, account_id: undefined }) }],
    ["no R2 bucket", { "wrangler.jsonc": JSON.stringify({ ...PILOT, r2_buckets: [] }) }],
    ["two databases", { "wrangler.jsonc": JSON.stringify({ ...PILOT, d1_databases: [...PILOT.d1_databases, { database_name: "x-db", database_id: "33333333-aaaa-bbbb-cccc-444444444444" }] }) }],
    ["a database name that is not a plain name", { "wrangler.jsonc": JSON.stringify({ ...PILOT, d1_databases: [{ ...PILOT.d1_databases[0], database_name: "--evil" }] }) }],
    ["a malformed reference list", { "wrangler.jsonc": JSON.stringify(PILOT), ".pilot-resources.json": JSON.stringify({ buckets: "nope" }) }],
  ])("refuses partial pilot knowledge (%s) before asking or spawning", (_label, files) => {
    const { calls, asked, tmp, out, run } = setup(files as Record<string, string>);
    expect(run()).toBe(1);
    expect([calls, asked, workdirs(tmp)]).toEqual([[], [], []]);
    for (const secret of ["fixture-pilot", ACCOUNT, "11111111"]) expect(out.join("\n")).not.toContain(secret);
  });
});

describe("pilot:export: what it writes and prints", () => {
  it("writes the snapshot to a 0600 file in a 0700 workdir and prints only counts and the hash", () => {
    const { tmp, out, run } = setup();
    expect(run()).toBe(0);
    const dir = join(tmp, workdirs(tmp)[0]!);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const file = join(dir, "export-1.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).tables).toEqual(ROWS);
    const text = out.join("\n");
    for (const t of tables) expect(text).toContain(`${t}=1`);
    for (const leak of ["Ana Demo", "Luis", "curso-demo", "fixture-pilot", ACCOUNT, "tok-secret-1", "secret stderr"]) expect(text).not.toContain(leak);
    expect(text).toMatch(/hash=[0-9a-f]{64}/);
    expect(text).not.toMatch(/MATCH|MISMATCH/);
  });

  it.each([
    ["wrangler fails", (s: any) => (s.status = 1)],
    ["output is not JSON", (s: any) => (s.stdout = "oops")],
    ["a statement failed", (s: any) => (s.stdout = JSON.stringify(tables.map(() => ({ results: [], success: false })))) ],
    ["fewer than four results", (s: any) => (s.stdout = JSON.stringify([{ results: [], success: true }]))],
  ])("%s: removes a freshly created workdir, writes nothing and fails without echoing output", (_label, tweak) => {
    const { tmp, out, state, run } = setup();
    tweak(state);
    expect(run()).not.toBe(0);
    expect(workdirs(tmp)).toEqual([]);
    expect(out.join("\n")).not.toMatch(/Ana Demo|secret stderr|oops/);
  });

  it("keeps a workdir that already existed when a later export fails", () => {
    const { tmp, state, run } = setup();
    run();
    const dir = join(tmp, workdirs(tmp)[0]!);
    state.status = 1;
    expect(run(dir)).not.toBe(0);
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "export-2.json"))).toBe(false);
  });
});

describe("pilot:export: repeat runs prove the freeze", () => {
  it("prints MATCH and exits 0 when the content is equal, whatever the key order and the meta", () => {
    const { tmp, out, state, run } = setup();
    run();
    const dir = join(tmp, workdirs(tmp)[0]!);
    const reordered = { ...ROWS, payments: [{ collection_id: "col-1", amount_cents: 1500, parent_name: "Ana Demo", id: "pay-1" }] };
    state.stdout = stdoutOf(reordered, 99);
    out.length = 0;
    expect(run(dir)).toBe(0);
    expect(out.join("\n")).toMatch(/\bMATCH\b/);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.exports.map((e: any) => e.matchesPrevious)).toEqual([null, true]);
  });

  it("prints MISMATCH and exits non-zero when one amount differs, without printing the rows", () => {
    const { tmp, out, state, run } = setup();
    run();
    const dir = join(tmp, workdirs(tmp)[0]!);
    state.stdout = stdoutOf({ ...ROWS, payments: [{ ...ROWS.payments[0]!, amount_cents: 1501 }] });
    out.length = 0;
    expect(run(dir)).toBe(3);
    expect(out.join("\n")).toMatch(/\bMISMATCH\b/);
    expect(out.join("\n")).not.toMatch(/1501|Ana Demo/);
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).exports.at(-1).matchesPrevious).toBe(false);
  });

  it("refuses a directory that is not a marked workdir without spawning", () => {
    const { tmp, calls, run } = setup();
    expect(run(tmp)).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe("pilot:cleanup", () => {
  it("removes a marked workdir and refuses anything else", () => {
    const { tmp, run, out, root } = setup();
    run();
    const dir = join(tmp, workdirs(tmp)[0]!);
    const ctx = { root: root + "/", log: { error: (m: string) => out.push(m), warn: () => undefined, log: () => undefined }, tmp };
    expect(runPilotCleanup([tmp], ctx)).toBe(1);
    expect(existsSync(tmp)).toBe(true);
    expect(runPilotCleanup([], ctx)).toBe(1);
    expect(runPilotCleanup([dir, "extra"], ctx)).toBe(1);
    expect(runPilotCleanup([dir], ctx)).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
});
