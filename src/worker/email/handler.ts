/**
 * Cloudflare Email Routing handler. The treasurer's Deuna account sends its "Recibiste $X" notifications to a
 * secret address. Every message is delivered to the treasurer first, no matter what (Email Routing forward in
 * self-host, a notification mail in Cloud); then archived; then, only for genuine Deuna mail (From + DKIM), the
 * transfer is stored and matched to a registered payment of the resolved tenant.
 *
 * Logs are structured JSON. They never include addresses or tokens, and payer data only stays in D1.
 */
import PostalMime from "postal-mime";
import type { DeunaImportResult } from "../../shared/api";
import type { RequestContext } from "../context";
import { NoticeCapped, type MailForwarder } from "../mail/mail-forwarder";
import { insertMovement } from "../movements";
import type { RawMailArchive } from "../storage/mail-archive";
import type { Tenant } from "../tenancy/tenant";
import { autoLinkMovement } from "./auto-link";
import { verifyDkim, type DkimResult } from "./dkim";
import { parseDeunaDetailed } from "./deuna";

export const DEUNA_SENDER = "notificaciones@deunaapp.com";
export const DEUNA_DOMAIN = "deunaapp.com";
export const MAX_RAW_BYTES = 1024 * 1024;

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

type RawRead = Uint8Array | "too_large" | "unreadable";

/** Reads the raw message, never more than MAX_RAW_BYTES. Returns why it could not when it is too large or the stream fails. */
async function readRaw(message: ForwardableEmailMessage): Promise<RawRead> {
  try {
    return await readBounded(message);
  } catch (e) {
    log("deuna_mail_read_failed", { error: errorText(e) });
    return "unreadable";
  }
}

async function readBounded(message: ForwardableEmailMessage): Promise<RawRead> {
  if (message.rawSize > MAX_RAW_BYTES) {
    log("deuna_mail_ignored", { reason: "too_large", size: message.rawSize });
    return "too_large";
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
      return "too_large";
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

/** True only for the exact Deuna sender AND a passing DKIM signature from deunaapp.com: the same two checks processDeunaRaw applies. Never throws. */
async function isVerifiedDeuna(raw: Uint8Array, verify: (raw: Uint8Array) => Promise<DkimResult>): Promise<boolean> {
  try {
    const email = await PostalMime.parse(raw);
    return email.from?.address?.trim().toLowerCase() === DEUNA_SENDER && (await verify(raw)).ok;
  } catch {
    return false;
  }
}

/**
 * How one inbound message is routed. Multi mode knows the tenant from the recipient before anything is read; single mode
 * resolves it lazily, AFTER the forward, so a database problem never stops the mail reaching the treasurer.
 */
export interface InboundRoute {
  forwarder: MailForwarder;
  /** Null: nothing is retained (self-host without a mail bucket). */
  archive: RawMailArchive | null;
  /** Cloud: verify From + DKIM BEFORE delivering, because the verdict decides whether the original may be attached. Self-host: false, it forwards first, unconditionally. */
  verifyBeforeDeliver: boolean;
  resolveTenant: () => Promise<Tenant | null>;
  loadContext: (tenant: Tenant) => Promise<RequestContext | null>;
}

/**
 * Order is fixed in both modes: buffer the raw stream (it is not guaranteed to be readable afterwards), deliver a copy
 * to the treasurer FIRST (always, even if reading failed), archive the raw message, then process. Cloud routes verify
 * DKIM once before delivering and reuse that result for processing. Each step is independent: a failure is logged
 * without addresses and never stops the next one. When neither the delivery nor the archive worked, the mail is lost
 * and `deuna_mail_lost` is logged at error level so it can be alerted on.
 */
export async function handleEmail(message: ForwardableEmailMessage, route: InboundRoute, deps: EmailDeps = {}): Promise<void> {
  const read = await readRaw(message);
  const raw = typeof read === "string" ? null : read;
  const unbuffered = typeof read === "string" ? read : null;

  let verify = deps.verify ?? ((bytes: Uint8Array) => verifyDkim(bytes, { domain: DEUNA_DOMAIN }));
  let verified = false;
  if (route.verifyBeforeDeliver && raw) {
    const base = verify;
    let cached: Promise<DkimResult> | undefined;
    verify = (bytes) => (cached ??= base(bytes));
    verified = await isVerifiedDeuna(raw, verify);
  }
  const processing: EmailDeps = { ...deps, verify };

  let delivered = false;
  try {
    await route.forwarder.deliver(message, raw, { verified, unbuffered });
    delivered = true;
  } catch (e) {
    if (e instanceof NoticeCapped) log("inbound_notice_capped");
    else log("deuna_mail_forward_failed", { error: errorText(e) });
  }

  let archived = false;
  try {
    // Nothing buffered (too large or unreadable): nothing to archive or process. The mail was already delivered.
    if (!raw) return;
    const tenant = await route.resolveTenant();
    if (!tenant) {
      log("deuna_mail_ignored", { reason: "no_tenant" });
      return;
    }
    if (route.archive) {
      try {
        await route.archive.put(tenant.id, raw);
        archived = true;
      } catch (e) {
        log("deuna_mail_archive_failed", { error: errorText(e) });
      }
    }
    const rc = await route.loadContext(tenant);
    if (!rc) {
      log("deuna_mail_ignored", { reason: "no_tenant" });
      return;
    }
    await processDeunaRaw(raw, rc, processing);
  } catch (e) {
    log("deuna_mail_error", { error: errorText(e) });
  } finally {
    if (!delivered && !archived) console.error(JSON.stringify({ message: "deuna_mail_lost" }));
  }
}

/**
 * Verifies and stores one raw Deuna notification, then tries to link it. Shared by the email() handler and the
 * admin .eml import, so both have the same security model: only a passing DKIM signature from deunaapp.com counts.
 * It logs as before and returns what happened; it throws only on unexpected failures (e.g. the database).
 */
export async function processDeunaRaw(raw: Uint8Array, { db, config }: Pick<RequestContext, "db" | "config">, deps: EmailDeps = {}): Promise<DeunaImportResult> {
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

  const lastDigits = config.treasury.accountNumber.slice(-4);
  if (!parsed.destinationAccount.endsWith(lastDigits)) {
    log("deuna_mail_wrong_account", { transaction: parsed.transactionNumber });
    return { status: "ignored", reason: "wrong_account" };
  }

  const now = (deps.now?.() ?? new Date()).toISOString();
  const movementId = await insertMovement(db, parsed, email.messageId ?? null, now);
  if (!movementId) {
    log("deuna_mail_duplicate", { transaction: parsed.transactionNumber });
    const existing = await db
      .prepare("SELECT id FROM bank_movements WHERE tenant_id = ?1 AND transaction_number = ?2")
      .bind(parsed.transactionNumber)
      .first<{ id: string }>();
    return { status: "duplicate", movementId: existing?.id ?? "" };
  }
  log("deuna_mail_stored", { transaction: parsed.transactionNumber, amountCents: parsed.amountCents });

  const paymentId = await autoLinkMovement(db, movementId, parsed, now);
  return paymentId ? { status: "stored", movementId, matched: true, paymentId } : { status: "stored", movementId, matched: false };
}
