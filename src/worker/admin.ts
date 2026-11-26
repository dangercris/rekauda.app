import type {
  AdminPayment,
  AdminPaymentStudent,
  AdminPaymentsResponse,
  AdminStatusResponse,
} from "../shared/api";
import { PAYMENT_STATUSES } from "../shared/api";
import { adminListCollections, createCollection, mutationResponse, updateCollection } from "./admin-collections";
import { assertSameOrigin, hasValidSession, isSafeMethod, login, logout } from "./auth";
import { parseOptions } from "./collections";
import { removeCover, setCover } from "./covers";
import { BASE_HEADERS, HttpError, json, readJson } from "./http";
import { importDeunaEml } from "./import";
import { ignoreMovement, listMovements, manualLink, toPaymentMovement, unlinkMovement } from "./movements";
import type { BankMovementRow, CollectionRow, PaymentRow } from "./rows";
import { cleanText, countBy, normalize } from "./validation";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_36 = /^[0-9a-f-]{36}$/;

export async function adminRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    throw new HttpError(503, "admin_disabled", "El acceso de administración no está configurado.");
  }
  const { pathname } = url;
  const method = request.method;

  // Every mutation (POST, DELETE...) must come from this origin, before anything else runs.
  if (!isSafeMethod(method)) assertSameOrigin(request, url);

  if (pathname === "/api/admin/login" && method === "POST") return login(request, env);
  if (pathname === "/api/admin/logout" && method === "POST") return logout();

  if (!(await hasValidSession(request, env))) throw new HttpError(401, "unauthorized", "Tu sesión expiró. Ingresa de nuevo.");

  if (pathname === "/api/admin/session" && method === "GET") return json({ ok: true });
  if (pathname === "/api/admin/payments" && method === "GET") return listPayments(env, url.searchParams.get("collection"));
  if (pathname === "/api/admin/collections" && method === "GET") return adminListCollections(env);
  if (pathname === "/api/admin/collections" && method === "POST") return createCollection(request, env);

  const collectionId = new RegExp(`^/api/admin/collections/(${UUID})$`).exec(pathname)?.[1];
  if (collectionId && method === "POST") return updateCollection(request, env, collectionId);

  const coverId = new RegExp(`^/api/admin/collections/(${UUID})/cover$`).exec(pathname)?.[1];
  if (coverId && method === "POST") {
    await setCover(request, env, coverId);
    return mutationResponse(env, coverId);
  }
  if (coverId && method === "DELETE") {
    await removeCover(env, coverId);
    return mutationResponse(env, coverId);
  }

  if (pathname === "/api/admin/movements" && method === "GET") return listMovements(env, url.searchParams.get("status"));
  if (pathname === "/api/admin/movements/import" && method === "POST") return importDeunaEml(request, env);
  const movementMatch = new RegExp(`^/api/admin/movements/(${UUID})/(link|unlink|ignore)$`).exec(pathname);
  if (movementMatch && method === "POST") {
    const [, movementId = "", action] = movementMatch;
    if (action === "link") return manualLink(request, env, movementId);
    if (action === "unlink") return unlinkMovement(env, movementId);
    return ignoreMovement(env, movementId);
  }

  const receiptId = new RegExp(`^/api/admin/receipts/(${UUID})$`).exec(pathname)?.[1];
  if (receiptId && method === "GET") return receipt(env, receiptId);

  const statusId = new RegExp(`^/api/admin/payments/(${UUID})/status$`).exec(pathname)?.[1];
  if (statusId && method === "POST") return updateStatus(request, env, statusId);

  throw new HttpError(404, "not_found", "Ruta no encontrada.");
}

async function listPayments(env: Env, collectionFilter: string | null): Promise<Response> {
  if (collectionFilter !== null && !UUID_36.test(collectionFilter)) {
    throw new HttpError(400, "invalid_collection", "Recaudación no válida.");
  }

  const { results: collections } = await env.DB.prepare("SELECT id, options_json FROM collections").all<Pick<CollectionRow, "id" | "options_json">>();
  const labelsByCollection = new Map(collections.map((c) => [c.id, new Map(parseOptions(c.options_json).map((o) => [o.key, o.label]))]));

  const paymentsQuery = collectionFilter
    ? env.DB.prepare("SELECT * FROM payments WHERE collection_id = ? ORDER BY created_at DESC").bind(collectionFilter)
    : env.DB.prepare("SELECT * FROM payments ORDER BY created_at DESC");
  const studentsQuery = collectionFilter
    ? env.DB.prepare(
        `SELECT s.payment_id, s.given_names, s.surnames, s.option_key FROM students s JOIN payments p ON p.id = s.payment_id
          WHERE p.collection_id = ? ORDER BY s.id`,
      ).bind(collectionFilter)
    : env.DB.prepare("SELECT payment_id, given_names, surnames, option_key FROM students ORDER BY id");

  const movementsQuery = collectionFilter
    ? env.DB.prepare(
        "SELECT m.* FROM bank_movements m JOIN payments p ON p.id = m.payment_id WHERE p.collection_id = ?",
      ).bind(collectionFilter)
    : env.DB.prepare("SELECT * FROM bank_movements WHERE payment_id IS NOT NULL");

  const [{ results: payments }, { results: students }, { results: movements }] = await Promise.all([
    paymentsQuery.all<PaymentRow>(),
    studentsQuery.all<{ payment_id: string; given_names: string; surnames: string; option_key: string }>(),
    movementsQuery.all<BankMovementRow>(),
  ]);
  const movementByPayment = new Map(movements.flatMap((m) => (m.payment_id ? [[m.payment_id, toPaymentMovement(m)] as const] : [])));

  const collectionByPayment = new Map(payments.map((p) => [p.id, p.collection_id]));
  const studentsByPayment = new Map<string, AdminPaymentStudent[]>();
  for (const s of students) {
    const labels = labelsByCollection.get(collectionByPayment.get(s.payment_id) ?? "");
    const list = studentsByPayment.get(s.payment_id) ?? [];
    list.push({ givenNames: s.given_names, surnames: s.surnames, option: s.option_key, optionLabel: labels?.get(s.option_key) ?? s.option_key });
    studentsByPayment.set(s.payment_id, list);
  }

  const shaCount = countBy(payments.filter((p) => p.status !== "anulado"), (p) => p.receipt_sha256);
  const refCount = countBy(
    payments.filter((p) => p.status !== "anulado" && p.reference),
    (p) => normalize(p.reference ?? ""),
  );

  return json({
    payments: payments.map(
      (p): AdminPayment => ({
        id: p.id,
        collectionId: p.collection_id,
        code: p.code,
        parentName: p.parent_name,
        phone: p.phone,
        amountCents: p.amount_cents,
        expectedCents: p.expected_cents,
        transferDate: p.transfer_date,
        bank: p.bank,
        reference: p.reference,
        receiptType: p.receipt_type,
        receiptSize: p.receipt_size,
        status: p.status,
        reviewNote: p.review_note,
        verification: p.verification,
        reviewedBy: p.reviewed_by,
        reviewedAt: p.reviewed_at,
        paidAt: p.paid_at,
        createdAt: p.created_at,
        students: studentsByPayment.get(p.id) ?? [],
        flags: {
          amountMismatch: p.amount_cents !== p.expected_cents,
          duplicateReceipt: p.status !== "anulado" && (shaCount.get(p.receipt_sha256) ?? 0) > 1,
          duplicateReference: p.status !== "anulado" && !!p.reference && (refCount.get(normalize(p.reference)) ?? 0) > 1,
        },
        bankMovement: movementByPayment.get(p.id) ?? null,
      }),
    ),
  } satisfies AdminPaymentsResponse);
}

async function receipt(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT code, receipt_key, receipt_type FROM payments WHERE id = ?")
    .bind(id)
    .first<Pick<PaymentRow, "code" | "receipt_key" | "receipt_type">>();
  if (!row) throw new HttpError(404, "not_found", "Comprobante no encontrado.");
  const object = await env.RECEIPTS.get(row.receipt_key);
  if (!object) throw new HttpError(404, "not_found", "El archivo del comprobante no está disponible.");

  const ext = row.receipt_key.split(".").pop() ?? "bin";
  const headers = new Headers({
    ...BASE_HEADERS,
    "Content-Type": row.receipt_type,
    "Content-Disposition": `inline; filename="comprobante-${row.code}.${ext}"`,
    "Cache-Control": "private, max-age=300",
  });
  if (row.receipt_type.startsWith("image/")) {
    headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  } else {
    // PDFs never render on this origin: download them instead.
    headers.set("Content-Disposition", `attachment; filename="comprobante-${row.code}.${ext}"`);
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  return new Response(object.body, { headers });
}

async function updateStatus(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJson(request);
  const status = PAYMENT_STATUSES.find((s) => s === body.status);
  if (!status) throw new HttpError(400, "invalid_status", "Estado no válido.");
  const note = typeof body.note === "string" ? cleanText(body.note, 300) : "";
  if ((status === "observado" || status === "anulado") && !note) {
    throw new HttpError(400, "note_required", "Escribe el motivo para que la familia sepa qué corregir.");
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE payments
        SET status = ?,
            review_note = CASE WHEN ? != '' THEN ? ELSE review_note END,
            reviewed_by = 'admin',
            reviewed_at = ?,
            paid_at = CASE WHEN ? = 'pagado' THEN ? ELSE NULL END,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(status, note, note, now, status, now, now, id)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "not_found", "Registro no encontrado.");

  console.log(JSON.stringify({ message: "status updated", id, status, by: "admin" }));
  return json({ ok: true, status } satisfies AdminStatusResponse);
}
