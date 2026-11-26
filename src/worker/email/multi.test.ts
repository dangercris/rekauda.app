/**
 * Cloud (multi mode) inbound mail through the real Worker entry point: one catch-all, the tenant comes from the
 * recipient token, every message is notified first, archived, then processed inside that tenant only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import { sha256Hex } from "../ids";
import type { CloudEnv } from "../env";
import { resetTenancyState } from "../tenancy/runtime";
import { asD1 } from "../test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "../test/d1-cloud";
import { seedPaymentFor } from "../test/harness";
import { FakeBucket, asR2 } from "../test/r2-fake";
import { generateKey, signMessage, type TestKey } from "../test/sign";

vi.mock("../og-image", () => ({ serveOgImage: async () => new Response("og-stub") }));

const DOMAIN = "in.example.test";
const TOKEN_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TOKEN_B = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

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
  ["To", "whoever@example.test"],
  ["Subject", "Recibiste $14,00 en tu cuenta Deuna"],
  ["Message-ID", "<abc123@deunaapp.com>"],
  ["Date", "Thu, 26 Nov 2026 14:02:11 +0000"],
  ["MIME-Version", "1.0"],
  ["Content-Type", "text/plain; charset=utf-8"],
  ["Content-Transfer-Encoding", "8bit"],
];

let key: TestKey;
let order: string[];
let logged: string[];
let errors: string[];
let limiterKeys: string[];

async function setup(options: { sendFails?: boolean; sendEmail?: boolean; failTokenLookup?: boolean; capped?: boolean } = {}) {
  const raw = createCloudTestDb({ seed: true });
  const set = raw.sqlite.prepare("UPDATE tenants SET inbound_token_hash = ? WHERE id = ?");
  set.run(await sha256Hex(new TextEncoder().encode(TOKEN_A)), TENANT_A);
  set.run(await sha256Hex(new TextEncoder().encode(TOKEN_B)), TENANT_B);
  const archive = new FakeBucket();
  const put = archive.put.bind(archive);
  archive.put = async (k, v) => (order.push("archive"), put(k, v));
  const sent: Array<{ to: string; text?: string; attachments?: unknown[] }> = [];
  limiterKeys = [];
  const db = {
    prepare: (sql: string) => {
      if (options.failTokenLookup && sql.includes("inbound_token_hash")) throw new Error("D1 unavailable");
      return raw.prepare(sql);
    },
    batch: (s: Parameters<typeof raw.batch>[0]) => raw.batch(s),
  };
  const env = {
    TENANCY: "multi",
    ROOT_DOMAIN: "rekauda.test",
    INBOUND_DOMAIN: DOMAIN,
    DB: asD1(db as unknown as typeof raw),
    RECEIPTS: asR2(new FakeBucket()),
    MAIL_ARCHIVE: asR2(archive),
    LOOKUP_LIMITER: { limit: async ({ key }: { key: string }) => (limiterKeys.push(key), { success: !options.capped }) },
    ...(options.sendEmail === false
      ? {}
      : {
          SEND_EMAIL: {
            send: async (m: { to: string; attachments?: unknown[] }) => {
              order.push("notify");
              if (options.sendFails) throw new Error(`rejected ${m.to}`);
              sent.push(m);
            },
          },
        }),
  } as unknown as CloudEnv;
  return { raw, env, archive, sent };
}

interface Inbound {
  message: ForwardableEmailMessage;
  setReject: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
  bodyReads: () => number;
}

function inbound(to: string, raw: string, options: { rawSize?: number } = {}): Inbound {
  const bytes = new TextEncoder().encode(raw);
  let reads = 0;
  const setReject = vi.fn();
  const forward = vi.fn();
  const message = {
    from: "bounce@deunaapp.com",
    to,
    headers: new Headers(),
    get raw() {
      reads += 1;
      return new Response(bytes).body;
    },
    rawSize: options.rawSize ?? bytes.byteLength,
    canBeForwarded: true,
    setReject,
    forward,
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
  return { message, setReject, forward, bodyReads: () => reads };
}

const signed = async (from?: string) => signMessage(key, headers(from), TEXT);
const dkimDns = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      order.push("dkim");
      return Response.json({ Answer: [{ type: 16, data: `"v=DKIM1; k=rsa; p=${key.publicBase64}"` }] });
    }),
  );
const count = (raw: ReturnType<typeof createCloudTestDb>, tenant: string) =>
  (raw.sqlite.prepare("SELECT count(*) AS n FROM bank_movements WHERE tenant_id = ?").get(tenant) as { n: number }).n;
const events = () => logged.map((l) => (JSON.parse(l) as { message: string }).message);
const deliver = (m: Inbound, env: CloudEnv) => worker.email!(m.message, env);

beforeEach(async () => {
  resetTenancyState();
  key ??= await generateKey();
  order = [];
  logged = [];
  errors = [];
  dkimDns();
  const sink = (line: unknown) => void logged.push(String(line));
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errors.push(String(line));
    sink(line);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("multi mode email()", () => {
  it.each([
    ["an unknown token", `d-${"0".repeat(32)}@${DOMAIN}`],
    ["another domain", `d-${TOKEN_A}@other.example.test`],
    ["a plus-addressing variant", `d-${TOKEN_A}+x@${DOMAIN}`],
    ["a malformed local part", `deuna@${DOMAIN}`],
  ])("rejects %s before reading the body: no notify, archive, forward or database write", async (_name, to) => {
    const { raw, env, archive, sent } = await setup();
    const m = inbound(to, await signed());
    await deliver(m, env);
    expect(m.setReject).toHaveBeenCalledTimes(1);
    expect(m.bodyReads()).toBe(0);
    expect(m.forward).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(archive.objects.size).toBe(0);
    expect(count(raw, TENANT_A) + count(raw, TENANT_B)).toBe(0);
    expect(events()).toContain("inbound_mail_rejected");
    expect(logged.join("\n")).not.toMatch(/example\.test|d-|a1b2c3d4/);
  });

  it("rejects (and reads nothing) when the token lookup fails, instead of dropping the mail silently", async () => {
    const { env, sent } = await setup({ failTokenLookup: true });
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed());
    await deliver(m, env);
    expect(m.setReject).toHaveBeenCalledTimes(1);
    expect(m.bodyReads()).toBe(0);
    expect(sent).toEqual([]);
    expect(events()).toContain("inbound_mail_lookup_failed");
  });

  it("rejects before reading when it could not notify anyone (send_email missing)", async () => {
    const { env } = await setup({ sendEmail: false });
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed());
    await deliver(m, env);
    expect(m.setReject).toHaveBeenCalledTimes(1);
    expect(m.bodyReads()).toBe(0);
    expect(events()).toContain("inbound_mail_not_configured");
  });

  it("routes a token to its tenant: notifies only its members, archives under its prefix, stores the movement there", async () => {
    const { raw, env, archive, sent } = await setup();
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed());
    await deliver(m, env);
    expect(m.setReject).not.toHaveBeenCalled();
    expect(m.forward).not.toHaveBeenCalled();
    expect(sent.map((s) => s.to)).toEqual(["owner-a@example.test"]);
    expect(sent[0]?.attachments).toHaveLength(1);
    expect([...archive.objects.keys()].map((k) => k.replace(/\/[^/]+$/, "/"))).toEqual([expect.stringMatching(new RegExp(`^t/${TENANT_A}/\\d{4}-\\d{2}-\\d{2}/$`))]);
    expect([count(raw, TENANT_A), count(raw, TENANT_B)]).toEqual([1, 0]);
  });

  it("keeps two tenants with the same transaction number apart", async () => {
    const { raw, env } = await setup();
    const rawMail = await signed();
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, rawMail), env);
    await deliver(inbound(`d-${TOKEN_B}@${DOMAIN}`, rawMail), env);
    expect([count(raw, TENANT_A), count(raw, TENANT_B)]).toEqual([1, 1]);
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, rawMail), env);
    expect([count(raw, TENANT_A), count(raw, TENANT_B)]).toEqual([1, 1]);
    expect(events()).toContain("deuna_mail_duplicate");
  });

  it("matches only among the recipient tenant's payments and never touches another tenant's", async () => {
    const { raw, env } = await setup();
    const inB = seedPaymentFor(raw, TENANT_B, { parentName: "Lucia Anais Torres", surnames: ["Perez"] }).id;
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    expect(raw.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(inB)).toMatchObject({ status: "en_revision", reviewed_by: null });
    expect(raw.sqlite.prepare("SELECT match_status, payment_id FROM bank_movements WHERE tenant_id = ?").get(TENANT_A)).toMatchObject({ match_status: "unmatched", payment_id: null });

    const inA = seedPaymentFor(raw, TENANT_A, { parentName: "Lucia Anais Torres", surnames: ["Perez"] }).id;
    await deliver(inbound(`d-${TOKEN_B}@${DOMAIN}`, await signed()), env);
    expect(raw.sqlite.prepare("SELECT status FROM payments WHERE id = ?").get(inA)).toMatchObject({ status: "en_revision" });
    expect(raw.sqlite.prepare("SELECT status, reviewed_by FROM payments WHERE id = ?").get(inB)).toMatchObject({ status: "recibido", reviewed_by: "deuna" });
  });

  it("never marks pagado, and leaves pagado and anulado rows alone", async () => {
    const { raw, env } = await setup();
    const paid = seedPaymentFor(raw, TENANT_A, { parentName: "Lucia Anais Torres", status: "pagado" }).id;
    const voided = seedPaymentFor(raw, TENANT_A, { parentName: "Lucia Anais Torres", status: "anulado" }).id;
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    for (const id of [paid, voided]) expect(raw.sqlite.prepare("SELECT reviewed_by FROM payments WHERE id = ?").get(id)).toMatchObject({ reviewed_by: null });
    expect(raw.sqlite.prepare("SELECT count(*) AS n FROM payments WHERE status = 'pagado'").get()).toMatchObject({ n: 1 });
  });

  it("verifies DKIM once (it decides the notice), then notifies, then archives, then processes without verifying again", async () => {
    const { env } = await setup();
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    expect(order).toEqual(["dkim", "notify", "archive"]);
  });

  it("notifies even when the notification, the archive and the database all fail afterwards", async () => {
    const { raw, env, archive } = await setup();
    archive.put = async () => Promise.reject(new Error("r2 down"));
    raw.sqlite.exec("DROP TABLE bank_movements");
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed());
    await expect(deliver(m, env)).resolves.toBeUndefined();
    // The archive put is the failing one here, so only dkim and notify were recorded, in that order.
    expect(order).toEqual(["dkim", "notify"]);
    expect(events()).toEqual(expect.arrayContaining(["deuna_mail_archive_failed", "deuna_mail_error"]));
  });

  it("processes the mail when the notification fails, logging no address", async () => {
    const { raw, env } = await setup({ sendFails: true });
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    expect(count(raw, TENANT_A)).toBe(1);
    expect(events()).toContain("deuna_mail_forward_failed");
    expect(logged.join("\n")).not.toMatch(/example\.test|a1b2c3d4/);
  });

  it("notifies and archives a spoofed sender and a failed DKIM but marks and stores nothing", async () => {
    const { raw, env, archive, sent } = await setup();
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed("Fake <notificaciones@deunaapp.com.evil.test>")), env);
    const unsigned = headers().map(([n, v]) => `${n}: ${v}`).join("\r\n") + "\r\n\r\n" + TEXT;
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, unsigned), env);
    expect(sent).toHaveLength(2);
    // Anything that is not verified Deuna mail gets a text-only notice: the platform never relays arbitrary content.
    expect(sent.map((s) => s.attachments)).toEqual([undefined, undefined]);
    expect(sent[0]?.text).toContain("no pudimos verificar como de Deuna");
    expect(archive.objects.size).toBe(2);
    expect(count(raw, TENANT_A)).toBe(0);
    expect(events()).toEqual(expect.arrayContaining(["deuna_mail_ignored"]));
  });

  it("sends a text-only notice for an oversized message and does not process it", async () => {
    const { raw, env, sent } = await setup();
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, "x", { rawSize: 2 * 1024 * 1024 });
    await deliver(m, env);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.attachments).toBeUndefined();
    expect(count(raw, TENANT_A)).toBe(0);
  });

  it("never logs an inbound address, a token, or a member email", async () => {
    const { env } = await setup({ sendFails: true });
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    await deliver(inbound(`d-${TOKEN_B}@other.example.test`, await signed()), env);
    expect(logged.join("\n")).not.toMatch(/a1b2c3d4|0f9e8d7c|example\.test|owner-/);
  });

  it("attaches the original only for a verified Deuna mail", async () => {
    const { env, sent } = await setup();
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    expect(sent[0]?.attachments).toHaveLength(1);
  });

  it("rejects before reading when the tenant has nobody to notify, logging no address", async () => {
    const { raw, env } = await setup();
    raw.sqlite.prepare("DELETE FROM sessions WHERE tenant_id = ?").run(TENANT_A);
    raw.sqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(TENANT_A);
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed());
    await deliver(m, env);
    expect(m.setReject).toHaveBeenCalledTimes(1);
    expect(m.bodyReads()).toBe(0);
    expect(events()).toContain("inbound_mail_no_recipients");
    expect(errors.join("\n")).toContain("inbound_mail_no_recipients");
    expect(logged.join("\n")).not.toMatch(/example\.test|a1b2c3d4/);
  });

  it("past the per-tenant notice cap it sends no notice, but still archives and processes", async () => {
    const { raw, env, archive, sent } = await setup({ capped: true });
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    expect(sent).toEqual([]);
    expect(archive.objects.size).toBe(1);
    expect(count(raw, TENANT_A)).toBe(1);
    expect(events()).toContain("inbound_notice_capped");
    expect(events()).not.toContain("deuna_mail_forward_failed");
    expect(limiterKeys).toEqual([`inbound-notice:${TENANT_A}`]);
  });

  it("logs deuna_mail_lost at error level when the notice fails and the archive fails", async () => {
    const { env, archive } = await setup({ sendFails: true });
    archive.put = async () => Promise.reject(new Error("r2 down"));
    const m = inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed());
    await deliver(m, env);
    expect(errors.join("\n")).toContain("deuna_mail_lost");
    expect(m.setReject).not.toHaveBeenCalled();
    expect(logged.join("\n")).not.toMatch(/example\.test|a1b2c3d4/);
  });

  it("does not report a loss when the notice failed but the archive kept the mail", async () => {
    const { env } = await setup({ sendFails: true });
    await deliver(inbound(`d-${TOKEN_A}@${DOMAIN}`, await signed()), env);
    expect(errors.join("\n")).not.toContain("deuna_mail_lost");
  });
});
