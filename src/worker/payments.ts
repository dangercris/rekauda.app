import type { RequestContext } from "./context";
import type { BaseEnv } from "./env";
import { receiptKey } from "./storage/keys";
import type { ConfigResponse, CreatePaymentResponse, LookupResponse } from "../shared/api";
import { autoLinkPayment } from "./email/auto-link";
import { findPublicCollection, parseOptions } from "./collections";
import { BANKS, CLASS_NAME, MAX_ACTIVE_PAYMENTS, MAX_BODY_BYTES, MAX_FILE_BYTES, SCHOOL_NAME, TREASURY } from "./constants";
import { HttpError, clientIp, enforceLimit, json, readMultipart } from "./http";
import { randomCode, sha256Hex, uniqueCode } from "./ids";
import type { PaymentRow } from "./rows";
import {
  displayName,
  normalizeCode,
  parseAmount,
  parseReference,
  parseStudents,
  parsePhone,
  parseTransferDate,
  personName,
  sniffReceipt,
  text,
} from "./validation";

const TOO_LARGE = "El comprobante supera los 5 MB. Sube una captura más liviana.";

export function publicConfig(): Response {
  return json({ className: CLASS_NAME, schoolName: SCHOOL_NAME, banks: BANKS, treasury: TREASURY } satisfies ConfigResponse, 200, {
    "Cache-Control": "public, max-age=300",
  });
}

export async function createPayment(request: Request, rc: RequestContext, env: Pick<BaseEnv, "SUBMIT_LIMITER">): Promise<Response> {
  const { db, storage } = rc;
  await enforceLimit(env.SUBMIT_LIMITER, `submit:${clientIp(request)}`);
  const form = await readMultipart(request, MAX_BODY_BYTES, TOO_LARGE);

  // Honeypot: real people never see or fill this field. Bots get a fake success.
  if (text(form.get("hp_c9x"))) return json({ ok: true, code: randomCode(), status: "en_revision" } satisfies CreatePaymentResponse, 201);

  const collection = await findPublicCollection(db, text(form.get("collection")).slice(0, 48));
  if (collection.status !== "abierta") {
    throw new HttpError(409, "collection_closed", "Esta recaudación ya está cerrada. Escribe al representante del curso.");
  }
  const options = parseOptions(collection.options_json);

  const active = await db
    .prepare("SELECT count(*) AS n FROM payments WHERE tenant_id = ?1 AND collection_id = ?2 AND status != 'anulado'")
    .bind(collection.id)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_PAYMENTS) {
    throw new HttpError(503, "full", "El registro está temporalmente cerrado. Escribe al representante del curso.");
  }

  if (text(form.get("consent")) !== "si") {
    throw new HttpError(400, "consent_required", "Debes aceptar el uso de tus datos para coordinar el pago.");
  }

  const students = parseStudents(text(form.get("students")), options, collection.max_per_payment);
  const parentName = personName(text(form.get("parentName")), "el nombre del representante");
  const phone = parsePhone(text(form.get("phone")));
  const transferDate = parseTransferDate(text(form.get("transferDate")));
  const bank = text(form.get("bank"));
  if (!BANKS.includes(bank)) throw new HttpError(400, "invalid_bank", "Elige el banco o cooperativa desde el que transferiste.");
  const amountCents = parseAmount(text(form.get("amount")));
  const reference = parseReference(text(form.get("reference")));

  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "receipt_required", "Adjunta el comprobante de la transferencia.");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "too_large", TOO_LARGE);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffReceipt(bytes);
  if (!kind) throw new HttpError(415, "unsupported_file", "El comprobante debe ser una imagen (JPG, PNG o WEBP) o un PDF.");
  // Duplicates are accepted and flagged for review (admin list + scripts/pending.sh), never blocked:
  // blocking would let whoever submits a copied receipt first lock out the real payer.
  const sha256 = await sha256Hex(bytes);

  const id = crypto.randomUUID();
  const code = await uniqueCode(db);
  const now = new Date().toISOString();
  const expectedCents = students.reduce((sum, s) => sum + s.option.cents, 0);

  const receiptStoredKey = await storage.put(receiptKey(id, kind.ext), bytes, {
    httpMetadata: { contentType: kind.type },
    customMetadata: { paymentId: id, code },
  });

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO payments (tenant_id, id, code, collection_id, parent_name, phone, amount_cents, expected_cents, transfer_date, bank, reference,
             receipt_key, receipt_type, receipt_size, receipt_sha256, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'en_revision', ?16, ?16)`,
        )
        .bind(id, code, collection.id, parentName, phone, amountCents, expectedCents, transferDate, bank, reference, receiptStoredKey, kind.type, bytes.byteLength, sha256, now),
      ...students.map((s) =>
        db.prepare("INSERT INTO students (tenant_id, payment_id, given_names, surnames, option_key, option_cents) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(
          id,
          s.givenNames,
          s.surnames,
          s.option.key,
          s.option.cents,
        ),
      ),
    ]);
  } catch (e) {
    await storage.delete(receiptStoredKey);
    throw e;
  }

  // The transfer may already be there (Deuna mail arrived first). Best-effort: never fails the registration.
  await autoLinkPayment(db, id, amountCents, now);

  console.log(JSON.stringify({ message: "payment registered", collection: collection.slug, students: students.length, amountCents, expectedCents }));
  return json({ ok: true, code, status: "en_revision" } satisfies CreatePaymentResponse, 201);
}

export async function lookup(request: Request, { db }: RequestContext, env: Pick<BaseEnv, "LOOKUP_LIMITER">, rawCode: string): Promise<Response> {
  await enforceLimit(env.LOOKUP_LIMITER, `lookup:${clientIp(request)}`);
  const code = normalizeCode(rawCode);
  if (!code) throw new HttpError(400, "invalid_code", "El código tiene 6 caracteres, por ejemplo K7Q-4MP.");

  const payment = await db
    .prepare(
      `SELECT p.id, p.code, p.status, p.review_note, p.amount_cents, p.expected_cents, p.created_at, p.reviewed_at, p.paid_at,
              c.slug AS collection_slug, c.title AS collection_title, c.options_json AS collection_options
         FROM payments p LEFT JOIN collections c ON c.id = p.collection_id AND c.tenant_id = ?1
        WHERE p.tenant_id = ?1 AND p.code = ?2`,
    )
    .bind(code)
    .first<
      Pick<PaymentRow, "id" | "code" | "status" | "review_note" | "amount_cents" | "expected_cents" | "created_at" | "reviewed_at" | "paid_at"> & {
        collection_slug: string | null;
        collection_title: string | null;
        collection_options: string | null;
      }
    >();
  if (!payment) throw new HttpError(404, "not_found", "No encontramos un registro con ese código. Revisa que esté bien escrito.");

  const { results } = await db
    .prepare("SELECT given_names, surnames, option_key FROM students WHERE tenant_id = ?1 AND payment_id = ?2 ORDER BY id")
    .bind(payment.id)
    .all<{ given_names: string; surnames: string; option_key: string }>();
  const labels = new Map(parseOptions(payment.collection_options ?? "[]").map((o) => [o.key, o.label]));

  return json({
    code: payment.code,
    status: payment.status,
    note: payment.status === "observado" || payment.status === "anulado" ? payment.review_note : null,
    amountCents: payment.amount_cents,
    expectedCents: payment.expected_cents,
    createdAt: payment.created_at,
    reviewedAt: payment.reviewed_at,
    paidAt: payment.paid_at,
    collection: { slug: payment.collection_slug ?? "", title: payment.collection_title ?? "" },
    students: results.map((s) => ({
      name: displayName(s.given_names, s.surnames),
      option: s.option_key,
      optionLabel: labels.get(s.option_key) ?? s.option_key,
    })),
  } satisfies LookupResponse);
}
