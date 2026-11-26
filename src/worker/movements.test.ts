import { timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMovementMutationResponse, AdminMovementsResponse, AdminPaymentsResponse } from "../shared/api";
import { adminRoute } from "./admin";
import { hmac } from "./auth";
import { insertMovement, linkMovement } from "./movements";
import { asD1, createTestDb, seedPayment, type TestDb } from "./test/d1";

const ORIGIN = "https://rekauda.test";
const SECRET = "test-session-secret";
let db: TestDb;
let cookie = "";

function env(): Env {
  // Only the bindings the admin routes touch are provided.
  return { DB: asD1(db), ADMIN_PASSWORD: "pw", SESSION_SECRET: SECRET, FORWARD_TO: "x@example.test" } as unknown as Env;
}

async function call(method: string, path: string, body?: unknown, options: { session?: boolean; origin?: string | null } = {}): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.session !== false) headers.set("cookie", cookie);
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  const request = new Request(`${ORIGIN}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    return await adminRoute(request, env(), new URL(request.url));
  } catch (e) {
    const status = (e as { status?: number }).status;
    const code = (e as { code?: string }).code;
    if (typeof status === "number") return Response.json({ error: code }, { status });
    throw e;
  }
}

async function addMovement(overrides: Partial<{ tx: string; amount: number }> = {}): Promise<string> {
  const id = await insertMovement(
    { DB: asD1(db) },
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

// Workers expose crypto.subtle.timingSafeEqual, Node does not.
if (!("timingSafeEqual" in crypto.subtle)) {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(new Uint8Array(a), new Uint8Array(b)),
  });
}

beforeEach(async () => {
  db = createTestDb();
  const exp = Math.floor(Date.now() / 1000) + 600;
  cookie = `adm=${exp}.${await hmac(SECRET, `adm:${exp}`)}`;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

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
      const paymentId = seedPayment(db, { status });
      expect(await linkMovement({ DB: asD1(db) }, input(movementId, paymentId))).toBe(false);
      expect(state(paymentId)).toMatchObject({ status, reviewed_by: null });
    }
    expect(db.sqlite.prepare("SELECT payment_id, match_status FROM bank_movements").get()).toMatchObject({ payment_id: null, match_status: "unmatched" });
  });

  it("never modifies a payment when the movement was linked elsewhere first", async () => {
    const movementId = await addMovement();
    const first = seedPayment(db);
    const second = seedPayment(db);
    expect(await linkMovement({ DB: asD1(db) }, input(movementId, first))).toBe(true);
    expect(await linkMovement({ DB: asD1(db) }, input(movementId, second))).toBe(false);
    expect(state(second)).toMatchObject({ status: "en_revision", reviewed_by: null });
    expect(db.sqlite.prepare("SELECT payment_id FROM bank_movements").get()).toMatchObject({ payment_id: first });
  });

  it("rolls the whole batch back when the payment already has another movement", async () => {
    const a = await addMovement({ tx: "1" + "0".repeat(11) });
    const b = await addMovement({ tx: "2" + "0".repeat(11) });
    const paymentId = seedPayment(db);
    expect(await linkMovement({ DB: asD1(db) }, input(a, paymentId))).toBe(true);
    await expect(linkMovement({ DB: asD1(db) }, input(b, paymentId))).rejects.toThrow(/UNIQUE/i);
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
    const paymentId = seedPayment(db, { status: "observado" });
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
    const paymentId = seedPayment(db, { status: "pagado" });
    expect((await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(paymentId)).toMatchObject({ status: "pagado", reviewed_by: null });
  });

  it("answers 409 when the payment or the movement is already linked, and for anulado payments", async () => {
    const first = await addMovement({ tx: "1" + "0".repeat(11) });
    const second = await addMovement({ tx: "2" + "0".repeat(11) });
    const paymentId = seedPayment(db);
    expect((await call("POST", `/api/admin/movements/${first}/link`, { paymentId })).status).toBe(200);
    expect((await call("POST", `/api/admin/movements/${second}/link`, { paymentId })).status).toBe(409);
    expect((await call("POST", `/api/admin/movements/${first}/link`, { paymentId: seedPayment(db) })).status).toBe(409);
    expect((await call("POST", `/api/admin/movements/${second}/link`, { paymentId: seedPayment(db, { status: "anulado" }) })).status).toBe(409);
  });

  it("validates the body and the ids", async () => {
    const movementId = await addMovement();
    expect((await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId: "nope" })).status).toBe(400);
    expect((await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId: "00000000-0000-4000-8000-0000000000ff" })).status).toBe(404);
    expect((await call("POST", `/api/admin/movements/00000000-0000-4000-8000-0000000000ff/ignore`, {})).status).toBe(404);
  });

  it("unlinks (payment keeps its status, movement is unmatched again) and ignores", async () => {
    const movementId = await addMovement();
    const paymentId = seedPayment(db);
    await call("POST", `/api/admin/movements/${movementId}/link`, { paymentId });
    expect((await call("POST", `/api/admin/movements/${movementId}/ignore`, {})).status).toBe(409);

    const unlinked = (await (await call("POST", `/api/admin/movements/${movementId}/unlink`, {})).json()) as AdminMovementMutationResponse;
    expect(unlinked.movement).toMatchObject({ paymentId: null, matchStatus: "unmatched" });
    expect(db.sqlite.prepare("SELECT status FROM payments WHERE id = ?").get(paymentId)).toMatchObject({ status: "recibido" });

    const ignored = (await (await call("POST", `/api/admin/movements/${movementId}/ignore`, {})).json()) as AdminMovementMutationResponse;
    expect(ignored.movement.matchStatus).toBe("ignored");
  });
});
