import { describe, expect, it } from "vitest";
import { makeTables, type PilotTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { assertNodeVersion, loadSnapshot } from "./pilot-snapshot.mjs";
// @ts-expect-error plain .mjs module without types
import { evaluateTarget, runPreflight } from "./preflight.mjs";

const failuresOf = (tables: PilotTables): Record<string, number> => {
  const result = runPreflight(loadSnapshot(tables), tables);
  return Object.fromEntries(result.failures.map((f: { check: string; count: number }) => [f.check, f.count]));
};
const mutate = (fn: (t: PilotTables) => void): PilotTables => {
  const tables = makeTables();
  fn(tables);
  return tables;
};

describe("assertNodeVersion", () => {
  it("accepts 22.18 and newer, refuses older", () => {
    expect(() => assertNodeVersion("22.18.0")).not.toThrow();
    expect(() => assertNodeVersion("24.1.0")).not.toThrow();
    expect(() => assertNodeVersion("22.17.9")).toThrow();
    expect(() => assertNodeVersion("20.19.0")).toThrow();
    expect(() => assertNodeVersion("nonsense")).toThrow();
  });
});

describe("loadSnapshot", () => {
  it("fails closed with a generic error when rows do not fit the pilot schema (duplicate id, bad status, unknown column)", () => {
    const dup = mutate((t) => t.collections.push({ ...t.collections[0]! }));
    const status = mutate((t) => { t.payments[0]!.status = "weird"; });
    const column = mutate((t) => { t.students[0]!.extra = 1; });
    for (const tables of [dup, status, column]) expect(() => loadSnapshot(tables)).toThrow(/snapshot/);
  });
});

describe("runPreflight", () => {
  it("passes a clean snapshot and reports counts only", () => {
    const result = runPreflight(loadSnapshot(makeTables()), makeTables());
    expect(result).toEqual({ ok: true, counts: { collections: 2, payments: 3, students: 3, bank_movements: 2 }, failures: [] });
  });

  it.each([
    ["payment without collection", (t: PilotTables) => { t.payments[0]!.collection_id = null; }, "payments_collection"],
    ["payment with orphan collection", (t: PilotTables) => { t.payments[0]!.collection_id = "ghost"; }, "payments_collection"],
    ["student with dangling payment", (t: PilotTables) => { t.students[0]!.payment_id = "ghost"; }, "students_payment"],
    ["movement with dangling payment", (t: PilotTables) => { t.bank_movements[0]!.payment_id = "ghost"; }, "movements_payment"],
    ["negative cents", (t: PilotTables) => { t.payments[0]!.amount_cents = -1; }, "cents"],
    ["unsafe cents", (t: PilotTables) => { t.students[0]!.option_cents = 2 ** 60; }, "cents"],
    ["fractional cents", (t: PilotTables) => { t.bank_movements[0]!.amount_cents = 10.5; }, "cents"],
    ["uppercase slug", (t: PilotTables) => { t.collections[0]!.slug = "Curso-Demo"; }, "slug"],
    ["slug with double dash", (t: PilotTables) => { t.collections[0]!.slug = "curso--demo"; }, "slug"],
    ["bad deadline", (t: PilotTables) => { t.collections[0]!.deadline = "15/12/2026"; }, "dates"],
    ["impossible date", (t: PilotTables) => { t.payments[0]!.transfer_date = "2026-02-31"; }, "dates"],
    ["invalid json column", (t: PilotTables) => { t.collections[0]!.options_json = "{oops"; }, "json"],
    ["receipt key for another id", (t: PilotTables) => { t.payments[0]!.receipt_key = "receipts/pay-9.jpg"; }, "receipt_key"],
    ["receipt key with bad extension", (t: PilotTables) => { t.payments[0]!.receipt_key = "receipts/pay-1.gif"; }, "receipt_key"],
    ["NUL in text", (t: PilotTables) => { t.payments[0]!.parent_name = "Ana\u0000"; }, "text"],
    ["lone surrogate in text", (t: PilotTables) => { t.payments[0]!.parent_name = "Ana\ud800"; }, "text"],
  ])("fails on %s with a count and no row content", (_label, change, check) => {
    const tables = mutate(change);
    const result = runPreflight(loadSnapshot(tables), tables);
    expect(result.ok).toBe(false);
    expect(failuresOf(tables)[check]).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result)).not.toMatch(/Familia|Ana|ghost|Demo/);
  });
});

describe("evaluateTarget", () => {
  const ok = { tenant: { id: "t-1", slug: "curso-demo", source: "pilot_import" }, rows: { collections: 0, payments: 0, students: 0, bank_movements: 0 }, collidingIds: 0 };
  const expected = { slug: "curso-demo", tenantId: "t-1" };

  it("accepts an empty pilot_import tenant with the expected slug", () => {
    expect(evaluateTarget(ok, expected)).toEqual({ ok: true, failures: [] });
  });

  it.each([
    ["missing tenant", { ...ok, tenant: null }],
    ["cloud source", { ...ok, tenant: { ...ok.tenant, source: "cloud" } }],
    ["other slug", { ...ok, tenant: { ...ok.tenant, slug: "otro" } }],
    ["other id", { ...ok, tenant: { ...ok.tenant, id: "t-2" } }],
    ["rows already there", { ...ok, rows: { ...ok.rows, payments: 1 } }],
    ["ids already exist globally", { ...ok, collidingIds: 2 }],
    ["malformed result", { tenant: {} }],
  ])("refuses %s", (_label, state) => {
    expect(evaluateTarget(state, expected).ok).toBe(false);
  });
});
