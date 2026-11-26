/**
 * Cloudflare Email Routing handler. The treasurer's Deuna account sends its "Recibiste $X" notifications to a
 * secret address on this domain. Every message is forwarded to the treasurer first, no matter what; then, only
 * for genuine Deuna mail (From + DKIM), the transfer is stored and matched to a registered payment.
 *
 * Logs are structured JSON. They never include the forward address, and payer data only stays in D1.
 */
import PostalMime from "postal-mime";
import type { DeunaImportResult } from "../../shared/api";
import { TREASURY } from "../constants";
import { insertMovement } from "../movements";
import { autoLinkMovement } from "./auto-link";
import { verifyDkim, type DkimResult } from "./dkim";
import { parseDeunaDetailed } from "./deuna";

export const DEUNA_SENDER = "notificaciones@deunaapp.com";
export const DEUNA_DOMAIN = "deunaapp.com";
export const MAX_RAW_BYTES = 1024 * 1024;

type EmailEnv = Pick<Env, "DB" | "FORWARD_TO">;

export interface EmailDeps {
  verify?: (raw: Uint8Array) => Promise<DkimResult>;
  now?: () => Date;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ message, ...fields }));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Reads the raw message, never more than MAX_RAW_BYTES. Returns null when it is too large. */
async function readRaw(message: ForwardableEmailMessage): Promise<Uint8Array | null> {
  if (message.rawSize > MAX_RAW_BYTES) {
    log("deuna_mail_ignored", { reason: "too_large", size: message.rawSize });
    return null;
  }
  const reader = message.raw.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RAW_BYTES) {
      await reader.cancel();
      log("deuna_mail_ignored", { reason: "too_large", size: total });
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function handleEmail(message: ForwardableEmailMessage, env: EmailEnv, deps: EmailDeps = {}): Promise<void> {
  // 1. Buffer the raw stream BEFORE forwarding: it is not guaranteed to be readable afterwards.
  let raw: Uint8Array | null = null;
  try {
    raw = await readRaw(message);
  } catch (e) {
    log("deuna_mail_read_failed", { error: errorText(e) });
  }

  // 2. Always forward, even when reading failed. A forward failure must not stop the processing.
  try {
    await message.forward(env.FORWARD_TO);
  } catch (e) {
    log("deuna_mail_forward_failed", { error: errorText(e) });
  }

  // 3. Process the buffered bytes. Any failure is logged and swallowed: the mail was already forwarded.
  if (!raw) return;
  try {
    await processDeunaRaw(raw, env, deps);
  } catch (e) {
    log("deuna_mail_error", { error: errorText(e) });
  }
}

/**
 * Verifies and stores one raw Deuna notification, then tries to link it. Shared by the email() handler and the
 * admin .eml import, so both have the same security model: only a passing DKIM signature from deunaapp.com counts.
 * It logs as before and returns what happened; it throws only on unexpected failures (e.g. the database).
 */
export async function processDeunaRaw(raw: Uint8Array, env: Pick<Env, "DB">, deps: EmailDeps = {}): Promise<DeunaImportResult> {
  if (raw.byteLength > MAX_RAW_BYTES) {
    log("deuna_mail_ignored", { reason: "too_large", size: raw.byteLength });
    return { status: "ignored", reason: "too_large" };
  }

  const email = await PostalMime.parse(raw);
  const from = email.from?.address?.trim().toLowerCase();
  if (from !== DEUNA_SENDER) {
    log("deuna_mail_ignored", { reason: "sender_not_deuna" });
    return { status: "ignored", reason: "sender_not_deuna" };
  }

  const verify = deps.verify ?? ((bytes: Uint8Array) => verifyDkim(bytes, { domain: DEUNA_DOMAIN }));
  const dkim = await verify(raw);
  if (!dkim.ok) {
    const signatures = dkim.signatures ?? [];
    if (dkim.reason === "key_unavailable") {
      // Not a verdict on the mail: the key lookup failed (after retries). Distinct and loud so it can be alerted on.
      console.error(JSON.stringify({ message: "deuna_mail_dkim_unavailable", reason: dkim.reason, signatures }));
      return { status: "ignored", reason: "dkim_unavailable", detail: dkim.reason, signatures };
    }
    log("deuna_mail_ignored", { reason: "dkim_failed", detail: dkim.reason, signatures });
    return { status: "ignored", reason: "dkim_failed", detail: dkim.reason, signatures };
  }

  const parse = parseDeunaDetailed({ text: email.text, html: email.html });
  if (!parse.ok) {
    log("deuna_mail_ignored", { reason: "not_a_payment", missing: parse.missing });
    return { status: "ignored", reason: "not_a_payment", missing: parse.missing };
  }
  const parsed = parse.payment;

  const lastDigits = TREASURY.accountNumber.slice(-4);
  if (!parsed.destinationAccount.endsWith(lastDigits)) {
    log("deuna_mail_wrong_account", { transaction: parsed.transactionNumber });
    return { status: "ignored", reason: "wrong_account" };
  }

  const now = (deps.now?.() ?? new Date()).toISOString();
  const movementId = await insertMovement(env, parsed, email.messageId ?? null, now);
  if (!movementId) {
    log("deuna_mail_duplicate", { transaction: parsed.transactionNumber });
    const existing = await env.DB.prepare("SELECT id FROM bank_movements WHERE transaction_number = ?")
      .bind(parsed.transactionNumber)
      .first<{ id: string }>();
    return { status: "duplicate", movementId: existing?.id ?? "" };
  }
  log("deuna_mail_stored", { transaction: parsed.transactionNumber, amountCents: parsed.amountCents });

  const paymentId = await autoLinkMovement(env, movementId, parsed, now);
  return paymentId ? { status: "stored", movementId, matched: true, paymentId } : { status: "stored", movementId, matched: false };
}
