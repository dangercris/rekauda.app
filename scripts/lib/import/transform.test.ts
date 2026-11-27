import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isRelativeKey } from "../../../src/worker/storage/keys";
import { TENANT_ID, makeTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { canonicalDigest } from "./canonical.mjs";
// @ts-expect-error plain .mjs module without types
import { loadSnapshot } from "./pilot-snapshot.mjs";
// @ts-expect-error plain .mjs module without types
import { literal } from "./sql-literal.mjs";
// @ts-expect-error plain .mjs module without types
import { transform } from "./transform.mjs";

const run = () => transform(loadSnapshot(makeTables()), { tenantId: TENANT_ID });

describe("transform", () => {
  it("adds the tenant to every row and keeps collection and payment ids", () => {
    const out = run();
    for (const table of ["collections", "payments", "students", "bank_movements"]) {
      expect(out[table].length).toBeGreaterThan(0);
      expect(out[table].every((r: Record<string, unknown>) => r.tenant_id === TENANT_ID)).toBe(true);
    }
    expect(out.collections.map((r: any) => r.id)).toEqual(["col-1", "col-2"]);
    expect(out.payments.map((r: any) => r.id)).toEqual(["pay-1", "pay-2", "pay-3"]);
  });

  it("clears cover_key because covers are re-uploaded by the owner", () => {
    expect(run().collections.every((r: any) => r.cover_key === null)).toBe(true);
  });

  it("rewrites receipt_key under the tenant prefix, keeping the extension and the receipt metadata", () => {
    const [p1, p2] = run().payments;
    expect(p1.receipt_key).toBe(`t/${TENANT_ID}/receipts/pay-1.jpg`);
    expect(p2.receipt_key).toBe(`t/${TENANT_ID}/receipts/pay-2.pdf`);
    expect(p1.receipt_sha256).toBe("ab".repeat(32));
    expect(p1.receipt_size).toBe(1234);
    expect(p1.receipt_type).toBe("image/jpeg");
  });

  it("produces receipt keys the Worker accepts once the tenant prefix is removed", () => {
    for (const p of run().payments) {
      expect(p.receipt_key.startsWith(`t/${TENANT_ID}/`)).toBe(true);
      expect(isRelativeKey(p.receipt_key.slice(`t/${TENANT_ID}/`.length))).toBe(true);
    }
  });

  it("copies reviewed_by verbatim, including null", () => {
    expect(run().payments.map((r: any) => r.reviewed_by)).toEqual(["admin", null, "deuna"]);
  });

  it("drops student ids and orders students by the old id", () => {
    const students = run().students;
    expect(students.every((r: any) => !("id" in r))).toBe(true);
    expect(students.map((r: any) => r.given_names)).toEqual(["Alumno 3", "Alumno 7", "Alumno 9"]);
  });

  it("keeps payment links of students and movements", () => {
    const out = run();
    expect(out.students.map((r: any) => r.payment_id)).toEqual(["pay-1", "pay-1", "pay-2"]);
    expect(out.bank_movements.map((r: any) => r.payment_id)).toEqual(["pay-1", null]);
  });
});

describe("literal", () => {
  it("renders null, safe integers and finite reals", () => {
    expect(literal(null)).toBe("NULL");
    expect(literal(1400)).toBe("1400");
    expect(literal(0.5)).toBe("0.5");
  });

  it("quotes text, doubling quotes and keeping newlines and unicode", () => {
    expect(literal("O'Neil\nñ ✓")).toBe("'O''Neil\nñ ✓'");
  });

  it.each([[Number.NaN], [Infinity], [2 ** 60], [true], [undefined], [{}], ["a\u0000b"], ["a\ud800"]])("refuses %s", (value) => {
    expect(() => literal(value)).toThrow();
  });
});

describe("canonicalDigest", () => {
  const rows = () => run().payments;
  it("is stable and ignores tenant_id", () => {
    const other = rows().map((r: any) => ({ ...r, tenant_id: "another-tenant" }));
    expect(canonicalDigest("payments", rows())).toBe(canonicalDigest("payments", other));
  });

  it("changes when one amount changes or the order changes", () => {
    const altered = rows().map((r: any, i: number) => (i === 0 ? { ...r, amount_cents: r.amount_cents + 1 } : r));
    expect(canonicalDigest("payments", altered)).not.toBe(canonicalDigest("payments", rows()));
    expect(canonicalDigest("payments", [...rows()].reverse())).not.toBe(canonicalDigest("payments", rows()));
  });

  it("throws when a column is missing instead of hashing a null", () => {
    const { amount_cents: _drop, ...partial } = rows()[0];
    expect(() => canonicalDigest("payments", [partial])).toThrow();
  });

  it("includes the table name in the hash input", () => {
    const columns = Object.keys(run().students[0]).filter((c) => c !== "tenant_id");
    const expected = createHash("sha256").update(JSON.stringify(["students", run().students.map((r: any) => columns.map((c) => r[c]))])).digest("hex");
    expect(canonicalDigest("students", run().students)).toBe(expected);
  });

  it("ignores the student id, so regenerated ids still match", () => {
    const students = run().students;
    const withIds = students.map((r: any, i: number) => ({ ...r, id: 100 + i }));
    expect(canonicalDigest("students", withIds)).toBe(canonicalDigest("students", students));
  });
});
