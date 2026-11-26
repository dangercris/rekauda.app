import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMovementMutationResponse, AdminMovementsResponse, AdminPaymentsResponse } from "../shared/api";
import { insertMovement, linkMovement } from "./movements";
import type { TestDb } from "./test/d1";
import { TENANT_A } from "./test/d1-cloud";
import { adminCall, createHarness, seedPaymentFor, type Harness, type SeedPaymentInput } from "./test/harness";

let h: Harness;
let db: TestDb;
const seed = (overrides: SeedPaymentInput = {}): string => seedPaymentFor(h.raw, TENANT_A, overrides).id;

const call = (method: string, path: string, body?: unknown, options: { session?: boolean; origin?: string | null } = {}) =>
  adminCall(h.a, method, path, body, options);

async function addMovement(overrides: Partial<{ tx: string; amount: number }> = {}): Promise<string> {
  const id = await insertMovement(
    h.a.db,
    {
      transactionNumber: overrides.tx ?? "111111111111",
      amountCents: overrides.amount ?? 1400,
      receivedAt: "2026-11-26T14:02:00.000Z",
      originBank: "Coop. Jep",
      originAccount: "********0000",
      destinationAccount: "******0000",
      payerName: "Torres Mendez Lucia Ana",
      motive: "Transf JEP",
    },
    "<m@x>",
    "2026-11-26T15:00:00.000Z",
  );
  if (!id) throw new Error("not inserted");
  return id;
}

beforeEach(() => {
  h = createHarness();
  db = h.raw;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  // Every statement of every test in this file ran as tenant A and passed the scope checker.
  h.spy.assertAllScoped(TENANT_A);
});

describe("insertMovement", () => {
  it("is idempotent on transaction_number", async () => {
    await addMovement();
    await expect(addMovement()).rejects.toThrow("not inserted");
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM bank_movements").get()).toMatchObject({ n: 1 });
  });
});

describe("linkMovement guards", () => {
  const input = (movementId: string, paymentId: string, matchStatus: "auto" | "manual" = "auto") => ({
    movementId,
    paymentId,
    transactionNumber: "111111111111",
    matchStatus,
    score: 0.9,
    now: "2026-11-26T15:00:00.000Z",
  });
  const state = (id: string) => db.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(id);

  it("does not auto-link a payment that became anulado or pagado after it was loaded", async () => {
    const movementId = await addMovement();
    for (const status of ["anulado", "pagado"] as const) {
      const paymentId = seed({ status });
      expect(await linkMovement(h.a.db, input(movementId, paymentId))).toBe(false);
      expect(state(paymentId)).toMatchObject({ status, reviewed_by: null });
    }
    expect(db.sqlite.prepare("SELECT payment_id, match_status FROM bank_movements").get()).toMatchObject({ payment_id: null, match_status: "unmatched" });
  });

  it("never modifies a payment when the movement was linked elsewhere first", async () => {
    const movementId = await addMovement();
    const first = seed();
    const second = seed();
    expect(await linkMovement(h.a.db, input(movementId, first))).toBe(true);
    expect(await linkMovement(h.a.db, input(movementId, second))).toBe(false);
    expect(state(second)).toMatchObject({ status: "en_revision", reviewed_by: null });
    expect(db.sqlite.prepare("SELECT payment_id FROM bank_movements").get()).toMatchObject({ payment_id: first });
  });

  it("rolls the whole batch back when the payment already has another movement", async () => {
    const a = await addMovement({ tx: "1" + "0".repeat(11) });
    const b = await addMovement({ tx: "2" + "0".repeat(11) });
    const paymentId = seed();
    expect(await linkMovement(h.a.db, input(a, paymentId))).toBe(true);
    await expect(linkMovement(h.a.db, input(b, paymentId))).rejects.toThrow(/UNIQUE/i);
    expect(db.sqlite.prepare("SELECT match_status FROM bank_movements WHERE id = ?").get(b)).toMatchObject({ match_status: "unmatched" });
  });
});

describe("admin movements API", () => {
  it("requires a session and a same-origin POST", async () => {
    const id = await addMovement();
    expect((await call("GET", "/api/admin/movements", undefined, { session: false })).status).toBe(401);
    expect((await call("POST", `/api/admin/movements/${id}/ignore`, {}, { origin: "https://evil.test" })).status).toBe(403);
    expect((await call("POST", `/api/admin/movements/${id}/ignore`, {}, { origin: null })).status).toBe(403);
    expect(db.sqlite.prepare("SELECT match_status FROM bank_movements").get()).toMatchObject({ match_status: "unmatched" });
  });

  it("lists unmatched movements by default and all on request", async () => {
    const a = await addMovement({ tx: "1" + "0".repeat(11) });
    await addMovement({ tx: "2" + "0".repeat(11) });
    await call("POST", `/api/admin/movements/${a}/ignore`, {});
    const unmatched = (await (await call("GET", "/api/admin/movements")).json()) as AdminMovementsResponse;
    expect(unmatched.movements).toHaveLength(1);
    const all = (await (await call("GET", "/api/admin/movements?status=all")).json()) as AdminMovementsResponse;
    expect(all.movements).toHaveLength(2);
    expect((await call("GET", "/api/admin/movements?status=nope")).status).toBe(400);
  });

  it("links manually: payment becomes recibido with the Deuna note, and the list shows the movement", async () => {
    const movementId = await addMovement();
    const paymentId = seed({ status: "observado" });
    const response = await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId });
    expect(response.status).toBe(200);
    const body = (await response.json()) as AdminMovementMutationResponse;
    expect(body.movement).toMatchObject({ paymentId, matchStatus: "manual", transactionNumber: "111111111111" });
    expect(db.sqlite.prepare("SELECT status, reviewed_by, review_note FROM payments WHERE id = ?").get(paymentId)).toMatchObject({
      status: "recibido",
      reviewed_by: "deuna",
      review_note: "Confirmado por notificación de Deuna (transacción 111111111111)",
    });

    const payments = (await (await call("GET", "/api/admin/payments")).json()) as AdminPaymentsResponse;
    expect(payments.payments.find((p) => p.id === paymentId)?.bankMovement).toMatchObject({
      id: movementId,
      amountCents: 1400,
      payerName: "Torres Mendez Lucia Ana",
      originBank: "Coop. Jep",
      matchStatus: "manual",
    });
  });

  it("does not touch the status of a pagado payment when linking", async () => {
    const movementId = await addMovement();
    const paymentId = seed({ status: "pagado" });
    expect((await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(paymentId)).toMatchObject({ status: "pagado", reviewed_by: null });
  });

  it("answers 409 when the payment or the movement is already linked, and for anulado payments", async () => {
    const first = await addMovement({ tx: "1" + "0".repeat(11) });
    const second = await addMovement({ tx: "2" + "0".repeat(11) });
    const paymentId = seed();
    expect((await call("POST", `/api/admin/movements/${first}/link`, { paymentId })).status).toBe(200);
    expect((await call("POST", `/api/admin/movements/${second}/link`, { paymentId })).status).toBe(409);
    expect((await call("POST", `/api/admin/movements/${first}/link`, { paymentId: seed() })).status).toBe(409);
    expect((await call("POST", `/api/admin/movements/${second}/link`, { paymentId: seed({ status: "anulado" }) })).status).toBe(409);
  });

  it("validates the body and the ids", async () => {
    const movementId = await addMovement();
    expect((await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId: "nope" })).status).toBe(400);
    expect((await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId: "00000000-0000-4000-8000-0000000000ff" })).status).toBe(404);
    expect((await call("POST", `/api/admin/movements/00000000-0000-4000-8000-0000000000ff/ignore`, {})).status).toBe(404);
  });

  it("unlinks (payment keeps its status, movement is unmatched again) and ignores", async () => {
    const movementId = await addMovement();
    const paymentId = seed();
    await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId });
    expect((await call("POST", `/api/admin/movements/${movementId}/ignore`, {})).status).toBe(409);

    const unlinked = (await (await call("POST", `/api/admin/movements/${movementId}/unlink`, {})).json()) as AdminMovementMutationResponse;
    expect(unlinked.movement).toMatchObject({ paymentId: null, matchStatus: "unmatched" });
    expect(db.sqlite.prepare("SELECT status FROM payments WHERE id = ?").get(paymentId)).toMatchObject({ status: "recibido" });

    const ignored = (await (await call("POST", `/api/admin/movements/${movementId}/ignore`, {})).json()) as AdminMovementMutationResponse;
    expect(ignored.movement.matchStatus).toBe("ignored");
  });
});
