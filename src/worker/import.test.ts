import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMovementImportResponse } from "../shared/api";
import { adminRoute } from "./admin";
import { processDeunaRaw } from "./email/handler";
import type { TestDb } from "./test/d1";
import { TENANT_A } from "./test/d1-cloud";
import { ADMIN_AUTH, adminCookie, createHarness, seedPaymentFor, type Harness } from "./test/harness";
import { generateKey, signMessage, type TestKey } from "./test/sign";

const ORIGIN = "https://rekauda.test";

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

const headers = (from = "Deuna <notificaciones@deunaapp.com>"): Array<[string, string]> => [
  ["From", from],
  ["To", "secret-address@example.test"],
  ["Subject", "Recibiste $14,00 en tu cuenta Deuna"],
  ["Message-ID", "<ses-1@deunaapp.com>"],
  ["Date", "Thu, 26 Nov 2026 14:02:11 +0000"],
  ["MIME-Version", "1.0"],
  ["Content-Type", "text/plain; charset=utf-8"],
  ["Content-Transfer-Encoding", "8bit"],
];

let h: Harness;
let db: TestDb;
let key: TestKey;
let cookie = "";
let logs: Array<Record<string, unknown>>;

function stubDns(publicKey: TestKey | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(publicKey ? { Answer: [{ type: 16, data: `"v=DKIM1; k=rsa; p=${publicKey.publicBase64}"` }] } : { Status: 3 })),
  );
}

async function upload(content: string | Uint8Array, options: { session?: boolean; field?: string } = {}): Promise<Response> {
  const form = new FormData();
  form.set(options.field ?? "eml", new File([typeof content === "string" ? content : new Uint8Array(content)], "mail.eml", { type: "message/rfc822" }));
  const packed = new Response(form);
  const body = new Uint8Array(await packed.arrayBuffer());
  const reqHeaders = new Headers({ origin: ORIGIN, "content-type": packed.headers.get("content-type") ?? "", "content-length": String(body.byteLength) });
  if (options.session !== false) reqHeaders.set("cookie", cookie);
  const request = new Request(`${ORIGIN}/api/admin/movements/import`, { method: "POST", headers: reqHeaders, body });
  try {
    return await adminRoute(request, h.a, ADMIN_AUTH, new URL(request.url));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (typeof status === "number") return Response.json({ error: (e as { code?: string }).code }, { status });
    throw e;
  }
}

const result = async (response: Response) => (await response.json()) as AdminMovementImportResponse;
const movements = () => db.sqlite.prepare("SELECT * FROM bank_movements").all() as Array<Record<string, unknown>>;

beforeAll(async () => {
  key = await generateKey();
});
beforeEach(async () => {
  h = createHarness();
  db = h.raw;
  cookie = await adminCookie();
  logs = [];
  stubDns(key);
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Every statement of every test in this file ran as tenant A and passed the scope checker (tests that never reach the database record none).
  if (h.spy.statements.length > 0) h.spy.assertAllScoped(TENANT_A);
});

describe("POST /api/admin/movements/import", () => {
  it("requires a session and a file", async () => {
    expect((await upload("x", { session: false })).status).toBe(401);
    expect((await upload("x", { field: "other" })).status).toBe(400);
    expect((await upload("")).status).toBe(400);
  });

  it("rejects files over 1 MB", async () => {
    expect((await upload(new Uint8Array(1024 * 1024 + 1))).status).toBe(413);
  });

  it("rejects a cross-origin upload", async () => {
    const request = new Request(`${ORIGIN}/api/admin/movements/import`, { method: "POST", headers: { origin: "https://evil.test", cookie } });
    await expect(adminRoute(request, h.a, ADMIN_AUTH, new URL(request.url))).rejects.toMatchObject({ status: 403 });
  });

  it("stores a DKIM-valid notification (folded SES-style signature) and links it, answering with the payment code", async () => {
    const id = seedPaymentFor(db, TENANT_A, { parentName: "Lucia Anais Torres", createdAt: "2026-11-25T20:00:00.000Z" }).id;
    const code = (db.sqlite.prepare("SELECT code FROM payments WHERE id = ?").get(id) as { code: string }).code;
    const raw = await signMessage(key, headers(), TEXT, { fold: true });
    const response = await upload(raw);
    expect(response.status).toBe(200);
    expect(await result(response)).toMatchObject({ status: "stored", matched: true, paymentId: id, paymentCode: code });
    expect(movements()[0]).toMatchObject({ transaction_number: "500000000001", message_id: "<ses-1@deunaapp.com>", match_status: "auto" });
  });

  it("stores without assigning when nothing matches, then reports a duplicate on re-import", async () => {
    const raw = await signMessage(key, headers(), TEXT);
    const first = await result(await upload(raw));
    expect(first).toMatchObject({ status: "stored", matched: false });
    const second = await result(await upload(raw));
    expect(second).toMatchObject({ status: "duplicate", movementId: (first as { movementId: string }).movementId });
    expect(movements()).toHaveLength(1);
  });

  it("explains a DKIM failure with the precise reason and per-signature diagnostics", async () => {
    const raw = await signMessage(key, headers(), TEXT);
    const body = await result(await upload(raw.replace("de Torres", "de Otra")));
    expect(body).toMatchObject({
      status: "ignored",
      reason: "dkim_failed",
      detail: "body_hash_mismatch",
      signatures: [{ d: "deunaapp.com", s: "s1", reason: "body_hash_mismatch" }],
    });
    expect(movements()).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ message: "deuna_mail_ignored", reason: "dkim_failed", signatures: [{ d: "deunaapp.com", s: "s1", reason: "body_hash_mismatch" }] }));
  });

  it("never trusts an unsigned upload", async () => {
    const unsigned = headers().map(([n, v]) => `${n}: ${v}`).join("\r\n") + "\r\n\r\n" + TEXT;
    expect(await result(await upload(unsigned))).toMatchObject({ status: "ignored", reason: "dkim_failed", detail: "no_signature" });
    expect(movements()).toHaveLength(0);
  });

  it("reports an unreachable key lookup separately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 502 })));
    const raw = await signMessage(key, headers(), TEXT);
    expect(await result(await upload(raw))).toMatchObject({ status: "ignored", reason: "dkim_unavailable", detail: "key_unavailable" });
  }, 10_000);

  it("lists the missing parser pieces without echoing the content", async () => {
    const raw = await signMessage(key, headers(), TEXT.replace("500000000001", "sin-numero"));
    const body = await result(await upload(raw));
    expect(body).toMatchObject({ status: "ignored", reason: "not_a_payment", missing: ["transaction_number"] });
    expect(JSON.stringify(logs)).not.toContain("Torres");
  });

  it("rejects other senders and other accounts", async () => {
    expect(await result(await upload(await signMessage(key, headers("Promos <promos@example.test>"), TEXT)))).toMatchObject({ reason: "sender_not_deuna" });
    expect(await result(await upload(await signMessage(key, headers(), TEXT.replace("Cuenta de destino: ******0000", "Cuenta de destino: ******1111"))))).toMatchObject({ reason: "wrong_account" });
  });
});

describe("processDeunaRaw", () => {
  it("accepts a folded SES-style signature (h= and tags over several lines)", async () => {
    const raw = await signMessage(key, headers(), TEXT, { fold: true });
    expect(raw).toMatch(/DKIM-Signature:[^]*?;\r\n\t/);
    const outcome = await processDeunaRaw(new TextEncoder().encode(raw), h.a);
    expect(outcome).toMatchObject({ status: "stored", matched: false });
  });

  it("reports every signature tried, not just the last", async () => {
    const good = await signMessage(key, headers(), TEXT);
    const other = await generateKey();
    const extra = (await signMessage(other, headers(), TEXT, { selector: "s2" })).split("\r\n")[0] ?? "";
    // Two signatures that both fail: the first uses the wrong key for s2, the second is tampered.
    const raw = `${extra}\r\n${good}`.replace("de Torres", "de Otra");
    const outcome = await processDeunaRaw(new TextEncoder().encode(raw), h.a);
    expect(outcome.status).toBe("ignored");
    if (outcome.status === "ignored") expect(outcome.signatures).toHaveLength(2);
  });
});
