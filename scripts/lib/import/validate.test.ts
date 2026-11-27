import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SLUG, makePilotWorld } from "./pilot-world";
import { TENANT_ID } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { readManifest } from "../private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { compareSummaries, runValidate, summarize } from "./validate.mjs";

function imported(opts: Parameters<typeof makePilotWorld>[0] = {}) {
  const w = makePilotWorld(opts);
  if (opts.plan !== false && opts.tenant !== null) w.cloud.sqlite.exec(readFileSync(join(w.dir, "import.sql"), "utf8"));
  const selects: string[] = [];
  const remote = { select: (sql: string) => (selects.push(sql), w.cloud.sqlite.prepare(sql).all()) };
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const run = (over: Record<string, unknown> = {}) => runValidate({ dir: w.dir, manifest: readManifest(w.dir), tenantId: TENANT_ID, slug: SLUG, ...over }, { remote, log }) as number;
  return { ...w, remote, selects, out, run };
}

describe("validation of the imported rows", () => {
  it("passes (MATCH, exit 0) on an exact import and reads only SELECTs scoped to the tenant", () => {
    const w = imported();
    expect(w.run()).toBe(0);
    expect(w.out.join("\n")).toMatch(/MATCH/);
    expect(w.out.join("\n")).not.toMatch(/MISMATCH/);
    for (const sql of w.selects) expect(sql).toMatch(/^SELECT [^;]*;$/);
    expect(w.selects.filter((s) => s.includes("FROM payments WHERE tenant_id = '" + TENANT_ID + "'")).length).toBeGreaterThan(0);
  });

  it("fails on one altered amount, naming the metric but never the row", () => {
    const w = imported();
    w.cloud.sqlite.exec("UPDATE payments SET amount_cents = amount_cents + 1 WHERE id = 'pay-1'");
    expect(w.run()).toBe(4);
    const text = w.out.join("\n");
    expect(text).toMatch(/MISMATCH.*payments\.digest/);
    expect(text).toMatch(/payments\.sum\.amount_cents/);
    expect(text).not.toMatch(/pay-1|Familia|Alumno|0990000000/);
  });

  it.each([
    ["a changed status", "UPDATE payments SET status = 'anulado' WHERE id = 'pay-2'", "payments.by.status"],
    ["a moved collection", "UPDATE payments SET collection_id = 'col-2' WHERE id = 'pay-1'", "payments.by.collection_id"],
    ["a missing student", "DELETE FROM students WHERE given_names = 'Alumno 9'", "students.count"],
    ["a changed movement status", "UPDATE bank_movements SET match_status = 'manual' WHERE id = 'mov-2'", "bank_movements.by.match_status"],
    ["a changed collection status", "UPDATE collections SET status = 'cerrada' WHERE id = 'col-1'", "collections.by.status"],
    ["a changed reviewer", "UPDATE payments SET reviewed_by = 'admin' WHERE id = 'pay-3'", "payments.digest"],
  ])("fails on %s", (_name, sql, metric) => {
    const w = imported();
    w.cloud.sqlite.exec(sql);
    expect(w.run()).toBe(4);
    expect(w.out.join("\n")).toContain(metric);
  });

  it("fails when a row is missing a column in the read-back or the read cannot be done", () => {
    const w = imported();
    const real = w.remote.select;
    w.remote.select = (sql: string) => (sql.includes("FROM payments WHERE") ? real(sql).map(({ amount_cents, ...rest }: any) => rest) : real(sql));
    expect(w.run()).toBe(1);
    const broken = imported();
    broken.remote.select = () => { throw new Error("boom Familia"); };
    expect(broken.run()).toBe(1);
    expect(broken.out.join("\n")).not.toMatch(/boom|Familia/);
  });

  it("refuses when the tenant is not the expected pilot_import tenant, or the plan is stale", () => {
    expect(imported({ tenant: { slug: SLUG, source: "cloud" } }).run()).toBe(1);
    expect(imported({ tenant: { slug: "otro-demo", source: "pilot_import" } }).run()).toBe(1);
    expect(imported({ plan: false }).run()).toBe(1);
  });
});

describe("summarize and compareSummaries (one function for expected and read-back)", () => {
  const rows = { collections: [], payments: [{ id: "p" }], students: [], bank_movements: [] };
  it("throws on a row missing a column instead of hashing it as null", () => {
    expect(() => summarize(rows)).toThrow();
  });
  it("lists the differing metrics only", () => {
    const a = { counts: { x: 1, y: 2 }, sums: {}, groups: {}, digests: {} };
    expect(compareSummaries(a, a)).toEqual([]);
    expect(compareSummaries(a, { ...a, counts: { x: 1, y: 3 } })).toEqual(["y.count"]);
  });
});
