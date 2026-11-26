import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../test/d1";
import { TENANT_A } from "../test/d1-cloud";
import { createHarness, seedPaymentFor, type Harness, type SeedPaymentInput } from "../test/harness";
import { generateKey, signMessage, txtFor, type TestKey } from "../test/sign";
import { autoLinkPayment } from "./auto-link";
import { verifyDkim } from "./dkim";
import { handleEmail, MAX_RAW_BYTES } from "./handler";

const NOW = new Date("2026-11-26T15:00:00.000Z");

const TEXT = `Hola, Ana
Recibiste $14,00 de Torres Mendez Lucia Ana con Deuna!
Los detalles de tu pago
Monto: $14,00 USD
Motivo: Transf JEP
Fecha: 26 nov 2026 - 09h02
Cuenta de origen: Coop. Jep ********0000
Cuenta de destino: ******0000
Nombre del ordenante: Torres Mendez Lucia Ana
Número de transacción: 500000000001
`.replace(/\n/g, "\r\n");

function mime(overrides: { from?: string; subject?: string; body?: string; messageId?: string } = {}): Array<[string, string]> {
  return [
    ["From", overrides.from ?? "Deuna <notificaciones@deunaapp.com>"],
    ["To", "secret-address@example.test"],
    ["Subject", overrides.subject ?? "Recibiste $14,00 en tu cuenta Deuna"],
    ["Message-ID", overrides.messageId ?? "<abc123@deunaapp.com>"],
    ["Date", "Thu, 26 Nov 2026 14:02:11 +0000"],
    ["MIME-Version", "1.0"],
    ["Content-Type", "text/plain; charset=utf-8"],
    ["Content-Transfer-Encoding", "8bit"],
  ];
}

function plain(headers: Array<[string, string]>, body: string): string {
  return headers.map(([n, v]) => `${n}: ${v}`).join("\r\n") + "\r\n\r\n" + body;
}

interface Mail {
  message: ForwardableEmailMessage;
  forward: ReturnType<typeof vi.fn>;
}

function mail(raw: string, forward = vi.fn(async () => ({ messageId: "x" }))): Mail {
  const bytes = new TextEncoder().encode(raw);
  const message = {
    from: "bounce@deunaapp.com",
    to: "secret-address@example.test",
    headers: new Headers(),
    raw: new Response(bytes).body,
    rawSize: bytes.byteLength,
    canBeForwarded: true,
    setReject: vi.fn(),
    forward,
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
  return { message, forward };
}

let h: Harness;
let db: TestDb;
const seedPayment = (overrides?: SeedPaymentInput): string => seedPaymentFor(h.raw, TENANT_A, overrides).id;
let key: TestKey;
let logs: Array<Record<string, unknown>>;

const ctxOf = async () => h.a;
const env = () => ({ FORWARD_TO: "treasurer@example.test" });
const verify = (raw: Uint8Array) => verifyDkim(raw, { domain: "deunaapp.com", resolveTxt: txtFor(key) });
const run = (m: Mail, deps: Parameters<typeof handleEmail>[3] = { verify, now: () => NOW }) => handleEmail(m.message, env(), ctxOf, deps);
const events = () => logs.map((l) => l["message"]);
const movements = () => db.sqlite.prepare("SELECT * FROM bank_movements").all() as Array<Record<string, unknown>>;

beforeEach(async () => {
  h = createHarness();
  db = h.raw;
  key ??= await generateKey();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
});
afterEach(() => {
  if (process.env["DBG"]) process.stderr.write(JSON.stringify(logs) + "\n");
  vi.restoreAllMocks();
  // Every statement of every test in this file ran as tenant A and passed the scope checker (tests that never reach the database record none).
  if (h.spy.statements.length > 0) h.spy.assertAllScoped(TENANT_A);
});

describe("email handler", () => {
  it("stores the movement and auto-links a clear match, moving the payment to recibido", async () => {
    const id = seedPayment({ parentName: "Lucia Anais Torres", surnames: ["Perez"], createdAt: "2026-11-25T20:00:00.000Z" });
    const raw = await signMessage(key, mime(), TEXT);
    const m = mail(raw);
    await run(m);

    expect(m.forward).toHaveBeenCalledWith("treasurer@example.test");
    const [row] = movements();
    expect(row).toMatchObject({
      transaction_number: "500000000001",
      amount_cents: 1400,
      received_at: "2026-11-26T14:02:00.000Z",
      origin_bank: "Coop. Jep",
      origin_account: "********0000",
      destination_account: "******0000",
      payer_name: "Torres Mendez Lucia Ana",
      motive: "Transf JEP",
      message_id: "<abc123@deunaapp.com>",
      payment_id: id,
      match_status: "auto",
    });
    const payment = db.sqlite.prepare("SELECT status, reviewed_by, review_note, paid_at FROM payments WHERE id = ?").get(id);
    expect(payment).toMatchObject({
      status: "recibido",
      reviewed_by: "deuna",
      review_note: "Confirmado por notificación de Deuna (transacción 500000000001)",
      paid_at: null,
    });
    expect(events()).toContain("deuna_mail_matched");
  });

  it("never marks a payment as pagado nor touches pagado/anulado", async () => {
    const paid = seedPayment({ parentName: "Lucia Anais Torres", status: "pagado", createdAt: "2026-11-25T20:00:00.000Z" });
    const void_ = seedPayment({ parentName: "Lucia Anais Torres", status: "anulado", createdAt: "2026-11-25T20:00:00.000Z" });
    await run(mail(await signMessage(key, mime(), TEXT)));
    expect(movements()[0]).toMatchObject({ match_status: "unmatched", payment_id: null });
    for (const id of [paid, void_]) {
      expect(db.sqlite.prepare("SELECT reviewed_by FROM payments WHERE id = ?").get(id)).toMatchObject({ reviewed_by: null });
    }
  });

  it("keeps a recibido payment as recibido and an observado one becomes recibido", async () => {
    const received = seedPayment({ parentName: "Lucia Anais Torres", status: "recibido", createdAt: "2026-11-25T20:00:00.000Z" });
    await run(mail(await signMessage(key, mime(), TEXT)));
    expect(db.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(received)).toMatchObject({ status: "recibido", reviewed_by: null });
    expect(movements()[0]).toMatchObject({ payment_id: received, match_status: "auto" });
  });

  it("leaves the movement unmatched when two families fit", async () => {
    seedPayment({ parentName: "Lucia Anais Torres", createdAt: "2026-11-25T20:00:00.000Z" });
    seedPayment({ parentName: "Anais Torres Mendez", createdAt: "2026-11-25T21:00:00.000Z" });
    await run(mail(await signMessage(key, mime(), TEXT)));
    expect(movements()[0]).toMatchObject({ match_status: "unmatched", payment_id: null });
  });

  it("ignores a duplicate transaction number", async () => {
    const raw = await signMessage(key, mime(), TEXT);
    await run(mail(raw));
    const second = mail(raw);
    await run(second);
    expect(movements()).toHaveLength(1);
    expect(second.forward).toHaveBeenCalledTimes(1);
    expect(events()).toContain("deuna_mail_duplicate");
  });

  it("forwards first, even when processing throws", async () => {
    const order: string[] = [];
    const forward = vi.fn(async () => {
      order.push("forward");
      return { messageId: "x" };
    });
    const m = mail(await signMessage(key, mime(), TEXT), forward);
    await run(m, {
      verify: async () => {
        order.push("verify");
        throw new Error("boom");
      },
      now: () => NOW,
    });
    expect(order).toEqual(["forward", "verify"]);
    expect(events()).toContain("deuna_mail_error");
    expect(movements()).toHaveLength(0);
  });

  it("survives a database failure after forwarding", async () => {
    const m = mail(await signMessage(key, mime(), TEXT));
    db.sqlite.exec("DROP TABLE bank_movements");
    await expect(run(m)).resolves.toBeUndefined();
    expect(m.forward).toHaveBeenCalledTimes(1);
    expect(events()).toContain("deuna_mail_error");
  });

  it("logs a forward failure without the address and keeps processing", async () => {
    const forward = vi.fn(async () => {
      throw new Error("destination address not verified");
    });
    const m = mail(await signMessage(key, mime(), TEXT), forward);
    await run(m);
    expect(events()).toContain("deuna_mail_forward_failed");
    expect(JSON.stringify(logs)).not.toContain("treasurer@example.test");
    expect(movements()).toHaveLength(1);
  });

  it("only forwards mail from other senders", async () => {
    const m = mail(await signMessage(key, mime({ from: "Promos <promos@example.test>" }), TEXT));
    await run(m);
    expect(m.forward).toHaveBeenCalledTimes(1);
    expect(movements()).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ message: "deuna_mail_ignored", reason: "sender_not_deuna" }));
  });

  it("only forwards when DKIM fails (spoofed sender, unsigned mail)", async () => {
    const m = mail(plain(mime(), TEXT));
    await run(m);
    expect(m.forward).toHaveBeenCalledTimes(1);
    expect(movements()).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ message: "deuna_mail_ignored", reason: "dkim_failed", detail: "no_signature" }));
  });

  it("ignores a Deuna mail that is not a payment (OTP)", async () => {
    const m = mail(await signMessage(key, mime({ subject: "Tu código" }), "Tu código Deuna es 482913."));
    await run(m);
    expect(movements()).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ message: "deuna_mail_ignored", reason: "not_a_payment" }));
  });

  it("rejects a transfer to another account", async () => {
    const m = mail(await signMessage(key, mime(), TEXT.replace("Cuenta de destino: ******0000", "Cuenta de destino: ******1111")));
    await run(m);
    expect(movements()).toHaveLength(0);
    expect(events()).toContain("deuna_mail_wrong_account");
  });

  it("skips parsing for oversized messages but still forwards", async () => {
    const m = mail("x");
    const big = { ...m.message, rawSize: MAX_RAW_BYTES + 1 } as unknown as ForwardableEmailMessage;
    await handleEmail(big, env(), ctxOf, { verify, now: () => NOW });
    expect(m.forward).toHaveBeenCalledTimes(1);
    expect(movements()).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ message: "deuna_mail_ignored", reason: "too_large" }));
  });

  it("buffers the raw stream before forwarding", async () => {
    const order: string[] = [];
    const bytes = new TextEncoder().encode(await signMessage(key, mime(), TEXT));
    const m = mail("");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        order.push("read");
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const forward = vi.fn(async () => {
      order.push("forward");
      return { messageId: "x" };
    });
    const message = { ...m.message, raw: stream, rawSize: bytes.byteLength, forward } as unknown as ForwardableEmailMessage;
    await handleEmail(message, env(), ctxOf, { verify, now: () => NOW });
    expect(order).toEqual(["read", "forward"]);
    expect(movements()).toHaveLength(1);
  });

  it("still forwards when the raw stream cannot be read", async () => {
    const m = mail("");
    const broken = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream failed");
      },
    });
    await handleEmail({ ...m.message, raw: broken, rawSize: 10 } as unknown as ForwardableEmailMessage, env(), ctxOf, { verify, now: () => NOW });
    expect(m.forward).toHaveBeenCalledTimes(1);
    expect(events()).toContain("deuna_mail_read_failed");
  });

  it("reports a failed key lookup as its own error event, not as a DKIM verdict", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = mail(await signMessage(key, mime(), TEXT));
    await run(m, {
      verify: (raw) =>
        verifyDkim(raw, {
          domain: "deunaapp.com",
          resolveTxt: async () => {
            throw new Error("doh down");
          },
          retryDelayMs: 0,
        }),
      now: () => NOW,
    });
    expect(m.forward).toHaveBeenCalledTimes(1);
    expect(movements()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("deuna_mail_dkim_unavailable"));
    expect(events()).not.toContain("deuna_mail_ignored");
  });

  it("verifies DKIM over DNS-over-HTTPS by default", async () => {
    const raw = await signMessage(key, mime(), TEXT);
    const fetchMock = vi.fn(async () => Response.json({ Answer: [{ type: 16, data: `"v=DKIM1; k=rsa; p=${key.publicBase64}"` }] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await handleEmail(mail(raw).message, env(), ctxOf, { now: () => NOW });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(movements()).toHaveLength(1);
  });
});

describe("payment registered after the transfer", () => {
  const link = (id: string, cents = 1400) => autoLinkPayment(h.a.db, id, cents, NOW.toISOString());

  it("links the stored movement to the payment and moves it to recibido", async () => {
    await run(mail(await signMessage(key, mime(), TEXT)));
    expect(movements()[0]).toMatchObject({ match_status: "unmatched", payment_id: null });

    const id = seedPayment({ parentName: "Lucia Anais Torres", surnames: ["Perez"], createdAt: "2026-11-26T16:00:00.000Z" });
    await link(id);
    expect(movements()[0]).toMatchObject({ match_status: "auto", payment_id: id });
    expect(db.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(id)).toMatchObject({ status: "recibido", reviewed_by: "deuna" });
    expect(events()).toContain("payment_movement_matched");
  });

  it("leaves everything alone when the name does not fit", async () => {
    await run(mail(await signMessage(key, mime(), TEXT)));
    const id = seedPayment({ parentName: "Familia Castro", surnames: ["Castro"] });
    await link(id);
    expect(movements()[0]).toMatchObject({ match_status: "unmatched", payment_id: null });
    expect(db.sqlite.prepare("SELECT status FROM payments WHERE id = ?").get(id)).toMatchObject({ status: "en_revision" });
  });

  it("does not link when two payments from similar families compete for the movement", async () => {
    await run(mail(await signMessage(key, mime(), TEXT)));
    seedPayment({ parentName: "Lucia Anais Torres", createdAt: "2026-11-26T16:00:00.000Z" });
    const second = seedPayment({ parentName: "Anais Torres Mendez", createdAt: "2026-11-26T16:01:00.000Z" });
    await link(second);
    expect(movements()[0]).toMatchObject({ match_status: "unmatched", payment_id: null });
  });

  it("never throws, even when the database fails", async () => {
    db.sqlite.exec("DROP TABLE bank_movements");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(link("00000000-0000-4000-8000-000000000999")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("does not touch a payment that is already pagado", async () => {
    await run(mail(await signMessage(key, mime(), TEXT)));
    const id = seedPayment({ parentName: "Lucia Anais Torres", status: "pagado", createdAt: "2026-11-26T16:00:00.000Z" });
    await link(id);
    expect(movements()[0]).toMatchObject({ match_status: "unmatched" });
  });
});
