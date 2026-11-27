import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "./lib/jsonc.mjs";
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

describe("productionRemote hands out only the methods it is asked for", () => {
  const make = (methods: string[]) => productionRemote({ root: "/x/", bin: "w", spawn: () => ({ status: 1 }), env: {}, log: console, checkFn: () => ({ result: { ok: true, warnings: [], violations: [] }, target: {} }), target: {}, methods });
  it.each([[["select", "file"]], [["select"]], [["select", "mutate"]]])("%j", (methods) => {
    expect(Object.keys(make(methods)).sort()).toEqual([...methods].sort());
  });
});
