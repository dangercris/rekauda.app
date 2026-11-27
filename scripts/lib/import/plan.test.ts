import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "../fake-checkout";
import { TENANT_ID, makeTables, type PilotTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { canonicalHash } from "../pilot-export.mjs";
// @ts-expect-error plain .mjs module without types
import { createWorkdir, writeManifest, readManifest } from "../private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { checkManifestGate, runImportPlan } from "./plan.mjs";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

interface Entry { file: string; hash: string; matchesFirst: boolean | null }
function setup(exportsOf: PilotTables[] = [makeTables(), makeTables()], tweak?: (m: any) => void) {
  const root = fakeCheckout("import-plan", {});
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "import-plan-tmp-")));
  dirs.push(root, tmp);
  const dir = createWorkdir({ root: root + "/", tmp });
  const manifest = readManifest(dir);
  exportsOf.forEach((tables, i) => {
    const file = `export-${i + 1}.json`;
    writeFileSync(join(dir, file), JSON.stringify({ version: 1, tables }), { mode: 0o600 });
    const hash = canonicalHash(tables);
    manifest.exports.push({ file, hash, counts: {}, at: "2026-11-27T00:00:00Z", matchesFirst: i === 0 ? null : hash === manifest.exports[0].hash });
  });
  tweak?.(manifest);
  writeManifest(dir, manifest);
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const run = (...args: string[]) => runImportPlan(args, { root: root + "/", log, tmp }) as number;
  return { dir, out, run, manifest };
}

describe("checkManifestGate", () => {
  const entry = (matchesFirst: boolean | null): Entry => ({ file: "f", hash: "h", matchesFirst });
  it("needs two exports, no mismatch ever seen and the latest matching the first", () => {
    expect(checkManifestGate({ exports: [entry(null), entry(true)] }).ok).toBe(true);
    expect(checkManifestGate({ exports: [entry(null)] }).ok).toBe(false);
    expect(checkManifestGate({ exports: [] }).ok).toBe(false);
    expect(checkManifestGate({ exports: [entry(null), entry(true)], mismatchSeen: true }).ok).toBe(false);
    expect(checkManifestGate({ exports: [entry(null), entry(false)] }).ok).toBe(false);
    expect(checkManifestGate({ exports: [entry(null), entry(false), entry(true)], mismatchSeen: true }).ok).toBe(false);
  });
});

describe("pilot:import:plan", () => {
  it("writes the SQL file into the workdir with mode 0600 and prints only counts", () => {
    const { dir, out, run } = setup();
    expect(run(dir, TENANT_ID)).toBe(0);
    const file = join(dir, "import.sql");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("INSERT INTO collections");
    const text = out.join("\n");
    expect(text).toMatch(/collections=2 payments=3 students=3 bank_movements=2/);
    expect(text).not.toMatch(/Familia|Demo|curso-demo|INSERT/);
  });

  it("refuses when the latest export file does not match its recorded hash", () => {
    const later = makeTables();
    later.collections.push({ ...later.collections[0]!, id: "col-3", slug: "extra-demo" });
    const { dir, run } = setup([makeTables(), makeTables(), later], (m) => {
      m.exports[2].matchesFirst = true;
      m.exports[2].hash = m.exports[1].hash;
    });
    // The third entry claims the same hash as the others but its file differs: the plan must notice and refuse.
    expect(run(dir, TENANT_ID)).toBe(1);
  });

  it("refuses without two matching exports and writes nothing", () => {
    for (const exportsOf of [[makeTables()], [makeTables(), { ...makeTables(), collections: [] }]]) {
      const { dir, run } = setup(exportsOf as PilotTables[]);
      expect(run(dir, TENANT_ID)).toBe(1);
      expect(readdirSync(dir)).not.toContain("import.sql");
    }
  });

  it("refuses a mismatch seen earlier even if the last export matches", () => {
    const { dir, run } = setup(undefined, (m) => { m.mismatchSeen = true; });
    expect(run(dir, TENANT_ID)).toBe(1);
  });

  it("fails the run on a preflight problem, listing counts only, with no SQL file", () => {
    const bad = makeTables();
    bad.payments[0]!.collection_id = "ghost";
    const { dir, out, run } = setup([bad, bad]);
    expect(run(dir, TENANT_ID)).toBe(1);
    expect(readdirSync(dir)).not.toContain("import.sql");
    expect(out.join("\n")).toMatch(/payments_collection=1/);
    expect(out.join("\n")).not.toMatch(/ghost|Familia/);
  });

  it.each([[[]], [["not-a-dir", TENANT_ID]], [["--force"]]])("refuses bad arguments %j", (args) => {
    const { run } = setup();
    expect(run(...(args as string[]))).toBe(1);
  });

  it("refuses a tenant id that is not a UUID", () => {
    const { dir, run } = setup();
    expect(run(dir, "curso-demo")).toBe(1);
    expect(readdirSync(dir)).not.toContain("import.sql");
  });
});

describe("import modules stay local", () => {
  const dir = new URL(".", import.meta.url).pathname;
  const sources = readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
  it("has the modules", () => expect(sources.length).toBeGreaterThanOrEqual(8));
  it.each(sources)("$f has no wrangler, network or process spawning", ({ text }) => {
    expect(text).not.toMatch(/wrangler|--remote|child_process|node:https?|node:net|fetch\s*\(/);
  });
});
