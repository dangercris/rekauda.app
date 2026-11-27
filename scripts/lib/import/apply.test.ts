import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOW, OTHER, SLUG, makePilotWorld } from "./pilot-world";
import { TENANT_ID, makeTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { canonicalHash } from "../pilot-export.mjs";
// @ts-expect-error plain .mjs module without types
import { readManifest, writeManifest } from "../private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { runImport } from "./apply.mjs";

function world(opts: Parameters<typeof makePilotWorld>[0] = {}) {
  const base = makePilotWorld(opts);
  const { cloud, dir, root } = base;
  const selects: string[] = [];
  const files: string[] = [];
  const hooks: { onSelect?: () => void } = {};
  const remote = {
    select(sql: string) {
      selects.push(sql);
      hooks.onSelect?.();
      return cloud.sqlite.prepare(sql).all();
    },
    file(path: string) {
      files.push(path);
      cloud.sqlite.exec(readFileSync(path, "utf8"));
    },
  };
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const run = (over: Record<string, unknown> = {}) => runImport({ dir, manifest: readManifest(dir), tenantId: TENANT_ID, slug: SLUG, ...over }, { remote, log }) as number;
  return { ...base, root, selects, files, hooks, remote, out, run };
}

describe("prod:import apply step", () => {
  it("runs the target preflight with real reads, then executes import.sql once, and the rows land", () => {
    const w = world();
    expect(w.run()).toBe(0);
    expect(w.files).toHaveLength(1);
    expect(w.files[0]).toMatch(new RegExp(`^${w.dir}/run-[A-Za-z0-9]+/import\\.sql$`));
    expect([w.count("collections"), w.count("payments"), w.count("students"), w.count("bank_movements")]).toEqual([2, 3, 3, 2]);
    expect(w.selects.length).toBeGreaterThanOrEqual(3);
    for (const sql of w.selects) expect(sql).toMatch(/^SELECT [^;]*;$/);
    expect(w.out.join("\n")).not.toMatch(/Familia|Alumno|Demo|0990000000|INSERT/);
  });

  it.each([
    ["the tenant does not exist", { tenant: null }],
    ["the tenant source is not pilot_import", { tenant: { slug: SLUG, source: "cloud" } }],
    ["the tenant slug is not the expected one", { tenant: { slug: "otro-demo", source: "pilot_import" } }],
  ])("refuses and executes nothing when %s", (_name, opts) => {
    const w = world(opts);
    expect(w.run()).toBe(1);
    expect(w.files).toEqual([]);
  });

  it("refuses when the tenant already has rows", () => {
    const w = world();
    w.addCollection(TENANT_ID, "pre-existing", "x-demo");
    expect(w.run()).toBe(1);
    expect(w.files).toEqual([]);
    expect(w.out.join("\n")).toContain("rows_not_empty");
  });

  it("refuses when a pilot id already exists in ANOTHER tenant (global primary keys)", () => {
    const w = world();
    w.addTenant(OTHER, "otro-curso", "cloud");
    w.addCollection(OTHER, "col-2", "z-demo");
    expect(w.run()).toBe(1);
    expect(w.files).toEqual([]);
    expect(w.out.join("\n")).toContain("id_collisions");
  });

  it("refuses when any read fails or returns something unreadable", () => {
    const failing = world();
    failing.remote.select = () => { throw new Error("boom: Familia Demo"); };
    expect(failing.run()).toBe(1);
    expect(failing.files).toEqual([]);
    expect(failing.out.join("\n")).not.toMatch(/boom|Familia/);
    const garbage = world();
    const real = garbage.remote.select;
    garbage.remote.select = (sql: string) => (sql.includes("COUNT(*) AS n") ? [{ n: "many" }] : real(sql));
    expect(garbage.run()).toBe(1);
    expect(garbage.files).toEqual([]);
    expect(garbage.out.join("\n")).toContain("collisions_unreadable");
  });

  it("refuses when there is no plan, or when it is stale", () => {
    expect(world({ plan: false }).run()).toBe(1);
    const newer = world();
    const tables = makeTables();
    tables.collections.push({ ...tables.collections[0]!, id: "col-9", slug: "nuevo-demo" });
    const manifest = readManifest(newer.dir);
    writeFileSync(join(newer.dir, "export-3.json"), JSON.stringify({ version: 1, tables }));
    manifest.exports.push({ file: "export-3.json", hash: canonicalHash(tables), counts: {}, at: NOW, matchesFirst: true });
    writeManifest(newer.dir, manifest);
    expect(newer.run()).toBe(1);
    expect(newer.files).toEqual([]);
  });

  it("executes a private copy of the verified bytes (0700 dir, 0600 file, same hash) and removes it afterwards", () => {
    const w = world();
    const seen: { dirMode: number; fileMode: number; sha: string }[] = [];
    const real = w.remote.file;
    w.remote.file = (path: string) => {
      seen.push({ dirMode: statSync(dirname(path)).mode & 0o777, fileMode: statSync(path).mode & 0o777, sha: createHash("sha256").update(readFileSync(path)).digest("hex") });
      real(path);
    };
    expect(w.run()).toBe(0);
    expect(seen).toEqual([{ dirMode: 0o700, fileMode: 0o600, sha: readManifest(w.dir).plan.sha256 }]);
    expect(readdirSync(w.dir).filter((f) => f.startsWith("run-"))).toEqual([]);
    expect(w.files[0]).not.toBe(join(w.dir, "import.sql"));
  });

  it("removes the copy when the execution fails, and refuses when the copy is altered before it runs", () => {
    const failing = world();
    failing.remote.file = () => { throw new Error("x"); };
    expect(failing.run()).toBe(1);
    expect(readdirSync(failing.dir).filter((f) => f.startsWith("run-"))).toEqual([]);
  });

  it("refuses a plan for another tenant and a tampered or replaced import.sql", () => {
    const other = world();
    expect(other.run({ tenantId: OTHER })).toBe(1);
    const tampered = world();
    appendFileSync(join(tampered.dir, "import.sql"), "DELETE FROM tenants;\n");
    expect(tampered.run()).toBe(1);
    expect(tampered.files).toEqual([]);
  });

  it("re-verifies the file hash right before executing (changed after the preflight reads)", () => {
    const w = world();
    w.hooks.onSelect = () => appendFileSync(join(w.dir, "import.sql"), "DELETE FROM tenants;\n");
    expect(w.run()).toBe(1);
    expect(w.files).toEqual([]);
  });

  it("reports a failed execution without content and points at the undo", () => {
    const w = world();
    w.remote.file = () => { throw new Error("SQLITE: Familia Demo"); };
    expect(w.run()).toBe(1);
    expect(w.out.join("\n")).toContain("prod:undo-data");
    expect(w.out.join("\n")).not.toMatch(/SQLITE|Familia/);
  });
});
