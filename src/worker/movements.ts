/**
 * Bank movements (Deuna notification emails): storage, linking to payments and the admin API.
 * Business rule: automation may move a payment to `recibido` (with a note); only the treasurer sets `pagado`.
 */
import type {
  AdminBankMovement,
  AdminMovementMutationResponse,
  AdminMovementsResponse,
  PaymentBankMovement,
} from "../shared/api";
import type { DeunaPayment } from "./email/deuna";
import type { TenantDb } from "./data/tenant-db";
import type { RequestContext } from "./context";
import { HttpError, json, readJson } from "./http";
import type { BankMovementRow, MatchStatus, PaymentRow } from "./rows";

const MOVEMENTS_LIMIT = 200;

export function toPaymentMovement(row: BankMovementRow): PaymentBankMovement {
  return {
    id: row.id,
    transactionNumber: row.transaction_number,
    amountCents: row.amount_cents,
    payerName: row.payer_name,
    originBank: row.origin_bank,
    receivedAt: row.received_at,
    matchStatus: row.match_status,
  };
}

export function toAdminMovement(row: BankMovementRow): AdminBankMovement {
  return {
    ...toPaymentMovement(row),
    originAccount: row.origin_account,
    destinationAccount: row.destination_account,
    motive: row.motive,
    paymentId: row.payment_id,
    matchScore: row.match_score,
    createdAt: row.created_at,
  };
}

export function confirmationNote(transactionNumber: string): string {
  return `Confirmado por notificación de Deuna (transacción ${transactionNumber})`;
}

/** Idempotent on transaction_number. Returns the new movement id, or null when it already existed. */
export async function insertMovement(db: TenantDb, parsed: DeunaPayment, messageId: string | null, now: string): Promise<string | null> {
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO bank_movements
         (tenant_id, id, source, transaction_number, amount_cents, received_at, origin_bank, origin_account, destination_account,
          payer_name, motive, message_id, payment_id, match_status, match_score, created_at)
       VALUES (?1, ?2, 'deuna_email', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, 'unmatched', NULL, ?12)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      id,
      parsed.transactionNumber,
      parsed.amountCents,
      parsed.receivedAt,
      parsed.originBank,
      parsed.originAccount,
      parsed.destinationAccount,
      parsed.payerName,
      parsed.motive,
      messageId,
      now,
    )
    .run();
  return result.meta.changes ? id : null;
}

export interface LinkInput {
  movementId: string;
  paymentId: string;
  transactionNumber: string;
  matchStatus: Extract<MatchStatus, "auto" | "manual">;
  score: number | null;
  now: string;
}

/**
 * Links a movement to a payment in one atomic batch and says whether it linked.
 * Both updates re-check the state they depend on, so a race between loading and writing cannot corrupt anything:
 * - the movement is linked only if it is still free and the payment is still linkable (auto: en_revision, recibido,
 *   observado; manual also accepts pagado, which is never modified; anulado never);
 * - the payment moves to recibido only if THIS movement ended up linked to it.
 * The unique index on payment_id makes the batch fail if another movement took the payment meanwhile.
 */
export async function linkMovement(db: TenantDb, input: LinkInput): Promise<boolean> {
  const linkable = input.matchStatus === "manual" ? "('en_revision', 'recibido', 'observado', 'pagado')" : "('en_revision', 'recibido', 'observado')";
  const [linked] = await db.batch([
    db
      .prepare(
        `UPDATE bank_movements SET payment_id = ?2, match_status = ?3, match_score = ?4
          WHERE tenant_id = ?1 AND id = ?5 AND payment_id IS NULL AND match_status IN ('unmatched', 'ignored')
            AND EXISTS (SELECT 1 FROM payments WHERE tenant_id = ?1 AND id = ?2 AND status IN ${linkable})`,
      )
      .bind(input.paymentId, input.matchStatus, input.score, input.movementId),
    db
      .prepare(
        `UPDATE payments
            SET status = 'recibido', reviewed_by = 'deuna', reviewed_at = ?2, review_note = ?3, updated_at = ?2
          WHERE tenant_id = ?1 AND id = ?4 AND status IN ('en_revision', 'observado')
            AND EXISTS (SELECT 1 FROM bank_movements WHERE tenant_id = ?1 AND id = ?5 AND payment_id = ?4)`,
      )
      .bind(input.now, confirmationNote(input.transactionNumber), input.paymentId, input.movementId),
  ]);
  return Boolean(linked?.meta.changes);
}

// ---------------------------------------------------------------- admin API

const UUID_36 = /^[0-9a-f-]{36}$/;

async function findMovement(db: TenantDb, id: string): Promise<BankMovementRow> {
  const row = await db.prepare("SELECT * FROM bank_movements WHERE tenant_id = ?1 AND id = ?2").bind(id).first<BankMovementRow>();
  if (!row) throw new HttpError(404, "not_found", "Movimiento no encontrado.");
  return row;
}

function mutationResponse(row: BankMovementRow): Response {
  return json({ ok: true, movement: toAdminMovement(row) } satisfies AdminMovementMutationResponse);
}

export async function listMovements({ db }: RequestContext, status: string | null): Promise<Response> {
  if (status !== null && status !== "unmatched" && status !== "all") {
    throw new HttpError(400, "invalid_status", "Estado no válido.");
  }
  const query =
    status === "all"
      ? db.prepare("SELECT * FROM bank_movements WHERE tenant_id = ?1 ORDER BY received_at DESC LIMIT ?2").bind(MOVEMENTS_LIMIT)
      : db
          .prepare("SELECT * FROM bank_movements WHERE tenant_id = ?1 AND match_status = 'unmatched' ORDER BY received_at DESC LIMIT ?2")
          .bind(MOVEMENTS_LIMIT);
  const { results } = await query.all<BankMovementRow>();
  return json({ movements: results.map(toAdminMovement) } satisfies AdminMovementsResponse);
}

export async function manualLink(request: Request, { db }: RequestContext, movementId: string): Promise<Response> {
  const body = await readJson(request);
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  if (!UUID_36.test(paymentId)) throw new HttpError(400, "invalid_payment", "Pago no válido.");

  const movement = await findMovement(db, movementId);
  if (movement.payment_id) throw new HttpError(409, "movement_already_linked", "Este movimiento ya está vinculado a un pago.");

  const payment = await db.prepare("SELECT id, status FROM payments WHERE tenant_id = ?1 AND id = ?2").bind(paymentId).first<Pick<PaymentRow, "id" | "status">>();
  if (!payment) throw new HttpError(404, "not_found", "Pago no encontrado.");
  if (payment.status === "anulado") throw new HttpError(409, "payment_void", "El pago está anulado.");
  const taken = await db.prepare("SELECT 1 AS taken FROM bank_movements WHERE tenant_id = ?1 AND payment_id = ?2").bind(paymentId).first();
  if (taken) throw new HttpError(409, "payment_already_linked", "Este pago ya está vinculado a otro movimiento.");

  let linked: boolean;
  try {
    linked = await linkMovement(db, {
      movementId,
      paymentId,
      transactionNumber: movement.transaction_number,
      matchStatus: "manual",
      score: null,
      now: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      throw new HttpError(409, "payment_already_linked", "Este pago ya está vinculado a otro movimiento.");
    }
    throw e;
  }
  if (!linked) throw new HttpError(409, "link_conflict", "El pago o el movimiento cambiaron. Actualiza la pantalla e intenta de nuevo.");
  console.log(JSON.stringify({ message: "movement linked", movementId, paymentId, how: "manual" }));
  return mutationResponse(await findMovement(db, movementId));
}

/** Detaches the movement from its payment. The payment keeps its current status: the treasurer decides. */
export async function unlinkMovement({ db }: RequestContext, movementId: string): Promise<Response> {
  await findMovement(db, movementId);
  await db
    .prepare("UPDATE bank_movements SET payment_id = NULL, match_status = 'unmatched', match_score = NULL WHERE tenant_id = ?1 AND id = ?2")
    .bind(movementId)
    .run();
  console.log(JSON.stringify({ message: "movement unlinked", movementId }));
  return mutationResponse(await findMovement(db, movementId));
}

export async function ignoreMovement({ db }: RequestContext, movementId: string): Promise<Response> {
  const movement = await findMovement(db, movementId);
  if (movement.payment_id) throw new HttpError(409, "movement_already_linked", "Desvincula el movimiento antes de ignorarlo.");
  await db.prepare("UPDATE bank_movements SET match_status = 'ignored' WHERE tenant_id = ?1 AND id = ?2").bind(movementId).run();
  console.log(JSON.stringify({ message: "movement ignored", movementId }));
  return mutationResponse(await findMovement(db, movementId));
}
