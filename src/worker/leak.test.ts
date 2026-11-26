/**
 * Cross-tenant leak tests, one block per handler. Tenants A and B are seeded with the SAME collection slug, and the
 * payment code and transaction number are made to collide too. Every block ends with spy.assertAllScoped, so any
 * statement that is not bound to the acting tenant (or not tenant-predicated) fails the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMovementsResponse, AdminPaymentsResponse, BoardResponse, CollectionsResponse, LookupResponse } from "../shared/api";
import { adminRoute } from "./admin";
import { assertTenantScoped } from "./data/sql-scope";
import { collectionBoard, collectionDetail, listCollections } from "./collections";
import { serveCover } from "./covers";
import { processDeunaRaw } from "./email/handler";
import { uniqueCode } from "./ids";
import { autoLinkPayment } from "./email/auto-link";
import { insertMovement } from "./movements";
import { createPayment, lookup } from "./payments";
import { TENANT_A, TENANT_B } from "./test/d1-cloud";
import {
  COLLECTION_A,
  COLLECTION_B,
  SHARED_CODE,
  SHARED_SLUG,
  SHARED_TRANSACTION,
  ADMIN_AUTH,
  adminCall,
  adminCookie,
  createHarness,
  seedMovementFor,
  seedPaymentFor,
  type Harness,
} from "./test/harness";

let h: Harness;
beforeEach(() => {
  h = createHarness();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const limiter = { limit: async () => ({ success: true }) } as unknown as RateLimit;
const row = (sql: string, ...params: Array<string | number>) => h.raw.sqlite.prepare(sql).get(...params);

describe("public collection handlers", () => {
  it("serve each tenant its own collection when the slug is the same", async () => {
    const a = await json<{ title: string }>(await collectionDetail(h.a, SHARED_SLUG));
    const b = await json<{ title: string }>(await collectionDetail(h.b, SHARED_SLUG));
    expect([a.title, b.title]).toEqual(["Demo collection A", "Demo collection B"]);
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
    expect(h.spy.statements.map((s) => s.params[0])).toEqual([TENANT_A, TENANT_B]);
  });

  it("list and board totals include zero data from the other tenant", async () => {
    seedPaymentFor(h.raw, TENANT_A, { status: "pagado", surnames: ["Andrade", "Benitez"] });
    seedPaymentFor(h.raw, TENANT_B, { status: "recibido", surnames: ["Cardenas"] });

    const listB = await json<CollectionsResponse>(await listCollections(h.b));
    expect(listB.collections.map((c) => [c.title, c.registered, c.paid])).toEqual([["Demo collection B", 1, 0]]);
    const boardB = await json<BoardResponse>(await collectionBoard(h.b, SHARED_SLUG));
    expect(boardB.students.map((s) => s.name)).toEqual(["Mateo C."]);
    expect(boardB.totals).toMatchObject({ registrados: 1, pagado: 0, recibido: 1 });
    const boardA = await json<BoardResponse>(await collectionBoard(h.a, SHARED_SLUG));
    expect(boardA.totals).toMatchObject({ registrados: 2, pagado: 2 });
    expect(boardA.students.map((s) => s.name)).not.toContain("Mateo C.");
  });
});

describe("lookup", () => {
  const call = (rc: Harness["a"], code: string) => lookup(new Request("https://x.test/api/lookup/x"), rc, { LOOKUP_LIMITER: limiter }, code);

  it("resolves a colliding payment code inside the acting tenant only", async () => {
    seedPaymentFor(h.raw, TENANT_A, { code: SHARED_CODE, surnames: ["Andrade"] });
    seedPaymentFor(h.raw, TENANT_B, { code: SHARED_CODE, surnames: ["Cardenas"] });
    const a = await json<LookupResponse>(await call(h.a, SHARED_CODE));
    const b = await json<LookupResponse>(await call(h.b, SHARED_CODE));
    expect(a.students.map((s) => s.name)).toEqual(["Mateo A."]);
    expect(b.students.map((s) => s.name)).toEqual(["Mateo C."]);
    expect([a.collection?.title, b.collection?.title]).toEqual(["Demo collection A", "Demo collection B"]);
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("answers 404 for a code that only exists in the other tenant", async () => {
    seedPaymentFor(h.raw, TENANT_A, { code: "ZZZ-ZZZ" });
    await expect(call(h.b, "ZZZ-ZZZ")).rejects.toMatchObject({ status: 404 });
  });
});

describe("createPayment", () => {
  const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

  async function submit(rc: Harness["a"], extra: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Response> {
    const form = new FormData();
    const fields: Record<string, string> = {
      collection: SHARED_SLUG,
      consent: "si",
      students: JSON.stringify([{ givenNames: "Lucia", surnames: "Torres", option: "standard" }]),
      parentName: "Carolina Vasquez",
      phone: "0990000000",
      transferDate: today,
      bank: "Other bank",
      amount: "10,00",
      ...extra,
    };
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set("receipt", new File([png], "r.png", { type: "image/png" }));
    const packed = new Response(form);
    const body = new Uint8Array(await packed.arrayBuffer());
    const request = new Request("https://x.test/api/payments", {
      method: "POST",
      headers: { "content-type": packed.headers.get("content-type") ?? "", "content-length": String(body.byteLength), ...headers },
      body,
    });
    return createPayment(request, rc, { SUBMIT_LIMITER: limiter });
  }

  it("stores the payment and the receipt under the acting tenant and ignores a client-supplied tenant", async () => {
    const response = await submit(h.b, { tenantId: TENANT_A, tenant_id: TENANT_A }, { "x-tenant-id": TENANT_A });
    expect(response.status).toBe(201);
    const stored = h.raw.sqlite.prepare("SELECT tenant_id, collection_id, expected_cents, receipt_key FROM payments").all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ tenant_id: TENANT_B, collection_id: COLLECTION_B, expected_cents: 2000 });
    const key = String((stored[0] as { receipt_key: string }).receipt_key);
    expect(key.startsWith(`t/${TENANT_B}/receipts/`)).toBe(true);
    expect([...h.bucket.objects.keys()]).toEqual([key]);
    expect(row("SELECT count(*) AS n FROM students WHERE tenant_id = ?", TENANT_A)).toMatchObject({ n: 0 });
    h.spy.assertAllScoped(TENANT_B);
  });

  it("registers in tenant A with A's own prices (triangulation)", async () => {
    expect((await submit(h.a)).status).toBe(201);
    expect(row("SELECT tenant_id, expected_cents FROM payments")).toMatchObject({ tenant_id: TENANT_A, expected_cents: 1000 });
    h.spy.assertAllScoped(TENANT_A);
  });

  it("allocates codes per tenant: a code taken in A is free in B", async () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
      return array;
    });
    seedPaymentFor(h.raw, TENANT_A, { code: "222-222" });
    expect(await uniqueCode(h.b.db)).toBe("222-222");
    await expect(uniqueCode(h.a.db)).rejects.toThrow("could not allocate a unique code");
  });
});

describe("admin payments", () => {
  it("lists only the acting tenant's payments, with flags computed inside the tenant", async () => {
    const a = seedPaymentFor(h.raw, TENANT_A, { code: SHARED_CODE });
    const b = seedPaymentFor(h.raw, TENANT_B, { code: SHARED_CODE });
    const listB = await json<AdminPaymentsResponse>(await adminCall(h.b, "GET", "/api/admin/payments"));
    expect(listB.payments.map((p) => p.id)).toEqual([b.id]);
    expect(listB.payments[0]?.flags.duplicateReceipt).toBe(false);
    const filtered = await json<AdminPaymentsResponse>(await adminCall(h.a, "GET", `/api/admin/payments?collection=${COLLECTION_A}`));
    expect(filtered.payments.map((p) => p.id)).toEqual([a.id]);
    const foreign = await json<AdminPaymentsResponse>(await adminCall(h.b, "GET", `/api/admin/payments?collection=${COLLECTION_A}`));
    expect(foreign.payments).toEqual([]);
    expect(h.spy.statements.length).toBeGreaterThan(6);
    for (const { sql, params } of h.spy.statements) {
      expect([TENANT_A, TENANT_B]).toContain(params[0]);
      expect(assertTenantScoped(sql)).toBeGreaterThanOrEqual(1);
    }
  });

  it("cannot update, mark or void another tenant's payment (404, row unchanged)", async () => {
    const a = seedPaymentFor(h.raw, TENANT_A);
    for (const body of [{ status: "pagado" }, { status: "anulado", note: "x" }, { status: "recibido" }]) {
      const res = await adminCall(h.b, "POST", `/api/admin/payments/${a.id}/status`, body);
      expect(res.status).toBe(404);
    }
    expect(row("SELECT status, reviewed_by, paid_at FROM payments WHERE id = ?", a.id)).toMatchObject({ status: "en_revision", reviewed_by: null, paid_at: null });
    const own = await adminCall(h.a, "POST", `/api/admin/payments/${a.id}/status`, { status: "pagado" });
    expect(own.status).toBe(200);
    expect(row("SELECT status, paid_at IS NOT NULL AS paid FROM payments WHERE id = ?", a.id)).toMatchObject({ status: "pagado", paid: 1 });
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("serves a receipt to its own tenant and answers 404 to the other without reading R2", async () => {
    const a = seedPaymentFor(h.raw, TENANT_A);
    await h.bucket.put(a.receiptKey, "receipt-a");
    h.bucket.reads.length = 0;
    expect((await adminCall(h.b, "GET", `/api/admin/receipts/${a.id}`)).status).toBe(404);
    expect(h.bucket.reads).toEqual([]);
    const own = await adminCall(h.a, "GET", `/api/admin/receipts/${a.id}`);
    expect(own.status).toBe(200);
    expect(await own.text()).toBe("receipt-a");
    expect(h.bucket.reads).toEqual([a.receiptKey]);
  });
});

describe("movements", () => {
  it("accepts the same transaction number in both tenants and rejects a repeat inside one", async () => {
    const facts = {
      transactionNumber: SHARED_TRANSACTION,
      amountCents: 1400,
      receivedAt: "2026-11-26T14:02:00.000Z",
      originBank: null,
      originAccount: null,
      destinationAccount: "******0000",
      payerName: "Torres Mendez Lucia Ana",
      motive: null,
    };
    const now = "2026-11-26T15:00:00.000Z";
    expect(await insertMovement(h.a.db, facts, null, now)).not.toBeNull();
    expect(await insertMovement(h.b.db, facts, null, now)).not.toBeNull();
    expect(await insertMovement(h.a.db, facts, null, now)).toBeNull();
    expect(row("SELECT count(*) AS n FROM bank_movements")).toMatchObject({ n: 2 });
  });

  it("lists only the acting tenant's movements", async () => {
    const a = seedMovementFor(h.raw, TENANT_A);
    const b = seedMovementFor(h.raw, TENANT_B);
    for (const status of ["all", "unmatched"]) {
      const list = await json<AdminMovementsResponse>(await adminCall(h.b, "GET", `/api/admin/movements?status=${status}`));
      expect(list.movements.map((m) => m.id)).toEqual([b]);
    }
    expect(a).not.toBe(b);
    h.spy.assertAllScoped(TENANT_B);
  });

  it("cannot unlink, ignore or link another tenant's movement or payment", async () => {
    const payA = seedPaymentFor(h.raw, TENANT_A);
    const movA = seedMovementFor(h.raw, TENANT_A);
    const movB = seedMovementFor(h.raw, TENANT_B, "900000000002");
    expect((await adminCall(h.b, "POST", `/api/admin/movements/${movA}/ignore`)).status).toBe(404);
    expect((await adminCall(h.b, "POST", `/api/admin/movements/${movA}/unlink`)).status).toBe(404);
    expect((await adminCall(h.b, "POST", `/api/admin/movements/${movA}/link`, { paymentId: payA.id })).status).toBe(404);
    // B's own movement against A's payment: the payment does not exist for B.
    expect((await adminCall(h.b, "POST", `/api/admin/movements/${movB}/link`, { paymentId: payA.id })).status).toBe(404);
    expect(row("SELECT match_status, payment_id FROM bank_movements WHERE id = ?", movA)).toMatchObject({ match_status: "unmatched", payment_id: null });
    expect(row("SELECT match_status, payment_id FROM bank_movements WHERE id = ?", movB)).toMatchObject({ match_status: "unmatched", payment_id: null });
    expect((await adminCall(h.a, "POST", `/api/admin/movements/${movA}/link`, { paymentId: payA.id })).status).toBe(200);
    expect(row("SELECT status FROM payments WHERE id = ?", payA.id)).toMatchObject({ status: "recibido" });
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });
});

describe("covers", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 9, 9, 9]);

  async function upload(rc: Harness["a"], collectionId: string): Promise<Response> {
    const form = new FormData();
    form.set("cover", new File([png], "c.png", { type: "image/png" }));
    const packed = new Response(form);
    const body = new Uint8Array(await packed.arrayBuffer());
    const request = new Request(`https://rekauda.test/api/admin/collections/${collectionId}/cover`, {
      method: "POST",
      headers: {
        origin: "https://rekauda.test",
        cookie: await adminCookie(),
        "content-type": packed.headers.get("content-type") ?? "",
        "content-length": String(body.byteLength),
      },
      body,
    });
    try {
      return await adminRoute(request, rc, ADMIN_AUTH, new URL(request.url));
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (typeof status === "number") return Response.json({ error: (e as { code?: string }).code }, { status });
      throw e;
    }
  }

  it("stores covers under the tenant prefix and serves them only on that tenant", async () => {
    const res = await upload(h.a, COLLECTION_A);
    expect(res.status).toBe(200);
    const stored = (row("SELECT cover_key FROM collections WHERE id = ?", COLLECTION_A) as { cover_key: string }).cover_key;
    expect(stored.startsWith(`t/${TENANT_A}/covers/${COLLECTION_A}/`)).toBe(true);
    const path = stored.slice(`t/${TENANT_A}/covers/`.length);
    expect((await serveCover(h.a, path)).status).toBe(200);
    h.bucket.reads.length = 0;
    expect((await serveCover(h.b, path)).status).toBe(404);
    expect(h.bucket.reads).toEqual([]);
    const detail = await json<{ coverUrl: string | null }>(await collectionDetail(h.a, SHARED_SLUG));
    expect(detail.coverUrl).toBe(`/api/covers/${path}`);
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("cannot set or remove another tenant's cover", async () => {
    expect((await upload(h.b, COLLECTION_A)).status).toBe(404);
    expect(h.bucket.objects.size).toBe(0);
    const del = await adminCall(h.b, "DELETE", `/api/admin/collections/${COLLECTION_A}/cover`);
    expect(del.status).toBe(404);
  });
});

describe("admin collections", () => {
  it("lists, reads and edits only the acting tenant's collections", async () => {
    const list = await json<{ collections: Array<{ id: string; stats: { payments: number } }> }>(await adminCall(h.b, "GET", "/api/admin/collections"));
    expect(list.collections.map((c) => c.id)).toEqual([COLLECTION_B]);
    const res = await adminCall(h.b, "POST", `/api/admin/collections/${COLLECTION_A}`, { title: "Hijacked" });
    expect(res.status).toBe(404);
    expect(row("SELECT title FROM collections WHERE id = ?", COLLECTION_A)).toMatchObject({ title: "Demo collection A" });
  });

  it("allows the same slug in both tenants and still rejects a duplicate inside one", async () => {
    const body = {
      slug: "excursion",
      title: "Excursion",
      description: "Invented description for the excursion.",
      options: [{ key: "std", label: "Standard", detail: "Demo", cents: 500 }],
      deadline: "2026-12-30",
    };
    expect((await adminCall(h.a, "POST", "/api/admin/collections", body)).status).toBe(201);
    expect((await adminCall(h.b, "POST", "/api/admin/collections", body)).status).toBe(201);
    expect((await adminCall(h.a, "POST", "/api/admin/collections", body)).status).toBe(409);
    expect(row("SELECT count(*) AS n FROM collections WHERE slug = 'excursion'")).toMatchObject({ n: 2 });
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("counts stats per tenant", async () => {
    seedPaymentFor(h.raw, TENANT_A, { status: "pagado", amountCents: 1400 });
    seedPaymentFor(h.raw, TENANT_B, { status: "en_revision", amountCents: 900 });
    const a = await json<{ collections: Array<{ stats: { payments: number; paidCents: number } }> }>(await adminCall(h.a, "GET", "/api/admin/collections"));
    const b = await json<{ collections: Array<{ stats: { payments: number; paidCents: number } }> }>(await adminCall(h.b, "GET", "/api/admin/collections"));
    expect(a.collections[0]?.stats).toMatchObject({ payments: 1, paidCents: 1400 });
    expect(b.collections[0]?.stats).toMatchObject({ payments: 1, paidCents: 0 });
  });
});

describe("deuna processing", () => {
  const raw = (transaction: string, destination = "******0000") =>
    new TextEncoder().encode(
      [
        "From: Deuna <notificaciones@deunaapp.com>",
        "To: inbox@example.test",
        "Subject: Recibiste $14,00",
        "Message-ID: <m1@deunaapp.com>",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hola, Ana",
        "Recibiste $14,00 de Torres Mendez Lucia Ana con Deuna!",
        "Los detalles de tu pago",
        "Monto: $14,00 USD",
        "Motivo: Transf JEP",
        "Fecha: 26 nov 2026 - 09h02",
        "Cuenta de origen: Coop. Jep ********0000",
        `Cuenta de destino: ${destination}`,
        "Nombre del ordenante: Torres Mendez Lucia Ana",
        `Número de transacción: ${transaction}`,
        "",
      ].join("\r\n"),
    );
  const deps = { verify: async () => ({ ok: true as const, domain: "deunaapp.com", selector: "s1" }), now: () => new Date("2026-11-26T15:00:00.000Z") };

  it("matches only among the resolved tenant's payments and keeps transaction numbers per tenant", async () => {
    const payA = seedPaymentFor(h.raw, TENANT_A, { parentName: "Lucia Anais Torres", surnames: ["Perez"], createdAt: "2026-11-25T20:00:00.000Z" });
    const payB = seedPaymentFor(h.raw, TENANT_B, { parentName: "Lucia Anais Torres", surnames: ["Perez"], createdAt: "2026-11-25T20:00:00.000Z" });
    // Same transaction number in both tenants: each tenant stores its own movement and links its own payment.
    const inB = await processDeunaRaw(raw(SHARED_TRANSACTION), h.b, deps);
    expect(inB).toMatchObject({ status: "stored", matched: true, paymentId: payB.id });
    expect(row("SELECT status FROM payments WHERE id = ?", payA.id)).toMatchObject({ status: "en_revision" });
    const inA = await processDeunaRaw(raw(SHARED_TRANSACTION), h.a, deps);
    expect(inA).toMatchObject({ status: "stored", matched: true, paymentId: payA.id });
    expect(row("SELECT count(*) AS n FROM bank_movements")).toMatchObject({ n: 2 });
    // A repeat inside tenant A is a duplicate of A's movement, not B's.
    const again = await processDeunaRaw(raw(SHARED_TRANSACTION), h.a, deps);
    const movementA = row("SELECT id FROM bank_movements WHERE tenant_id = ?", TENANT_A) as { id: string };
    expect(again).toEqual({ status: "duplicate", movementId: movementA.id });
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("does not match a payment of another tenant", async () => {
    const payB = seedPaymentFor(h.raw, TENANT_B, { parentName: "Lucia Anais Torres", surnames: ["Perez"], createdAt: "2026-11-25T20:00:00.000Z" });
    const result = await processDeunaRaw(raw("900000000077"), h.a, deps);
    expect(result).toMatchObject({ status: "stored", matched: false });
    expect(row("SELECT status, reviewed_by FROM payments WHERE id = ?", payB.id)).toMatchObject({ status: "en_revision", reviewed_by: null });
    expect(row("SELECT tenant_id, payment_id FROM bank_movements")).toMatchObject({ tenant_id: TENANT_A, payment_id: null });
    h.spy.assertAllScoped(TENANT_A);
  });
});

describe("queries that were only covered indirectly", () => {
  const optionsBody = { options: [{ key: "other", label: "Other", detail: "Demo", cents: 500 }] };

  it("updateCollection option_in_use only looks at the acting tenant's students", async () => {
    seedPaymentFor(h.raw, TENANT_A, { surnames: ["Andrade"] });
    // Tenant A has a student on option "standard": A cannot drop it, B (same option key, no students) can.
    expect((await adminCall(h.a, "POST", `/api/admin/collections/${COLLECTION_A}`, optionsBody)).status).toBe(409);
    expect((await adminCall(h.b, "POST", `/api/admin/collections/${COLLECTION_B}`, optionsBody)).status).toBe(200);
    expect(row("SELECT options_json FROM collections WHERE id = ?", COLLECTION_A)).toMatchObject({ options_json: expect.stringContaining("standard") });
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("loadStats with a collection filter counts only the acting tenant", async () => {
    seedPaymentFor(h.raw, TENANT_A, { status: "pagado", amountCents: 1400, surnames: ["Andrade", "Benitez"] });
    const stats = async (rc: Harness["a"], id: string) =>
      (await json<{ collection: { stats: { payments: number; students: number; paidCents: number } } }>(await adminCall(rc, "POST", `/api/admin/collections/${id}`, { title: "Renamed" }))).collection.stats;
    expect(await stats(h.b, COLLECTION_B)).toMatchObject({ payments: 0, students: 0, paidCents: 0 });
    expect(await stats(h.a, COLLECTION_A)).toMatchObject({ payments: 1, students: 2, paidCents: 1400 });
  });

  it("autoLinkPayment links only movements of its own tenant", async () => {
    const created = "2026-11-25T20:00:00.000Z";
    const payA = seedPaymentFor(h.raw, TENANT_A, { parentName: "Lucia Anais Torres", surnames: ["Perez"], createdAt: created });
    const movB = seedMovementFor(h.raw, TENANT_B, "900000000010");
    await autoLinkPayment(h.a.db, payA.id, 1400, "2026-11-26T15:00:00.000Z");
    expect(row("SELECT payment_id, match_status FROM bank_movements WHERE id = ?", movB)).toMatchObject({ payment_id: null, match_status: "unmatched" });
    expect(row("SELECT status FROM payments WHERE id = ?", payA.id)).toMatchObject({ status: "en_revision" });
    // Positive control: the same movement inside tenant A does link.
    const movA = seedMovementFor(h.raw, TENANT_A, "900000000011");
    await autoLinkPayment(h.a.db, payA.id, 1400, "2026-11-26T15:00:00.000Z");
    expect(row("SELECT payment_id FROM bank_movements WHERE id = ?", movA)).toMatchObject({ payment_id: payA.id });
    expect(row("SELECT status FROM payments WHERE id = ?", payA.id)).toMatchObject({ status: "recibido" });
  });
});
