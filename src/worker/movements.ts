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
export async function insertMovement(env: Pick<Env, "DB">, parsed: DeunaPayment, messageId: string | null, now: string): Promise<string | null> {
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO bank_movements
       (id, source, transaction_number, amount_cents, received_at, origin_bank, origin_account, destination_account,
        payer_name, motive, message_id, payment_id, match_status, match_score, created_at)
     VALUES (?, 'deuna_email', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unmatched', NULL, ?)`,
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
export async function linkMovement(env: Pick<Env, "DB">, input: LinkInput): Promise<boolean> {
  const linkable = input.matchStatus === "manual" ? "('en_revision', 'recibido', 'observado', 'pagado')" : "('en_revision', 'recibido', 'observado')";
  const [linked] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE bank_movements SET payment_id = ?, match_status = ?, match_score = ?
        WHERE id = ? AND payment_id IS NULL AND match_status IN ('unmatched', 'ignored')
          AND EXISTS (SELECT 1 FROM payments WHERE id = ? AND status IN ${linkable})`,
    ).bind(input.paymentId, input.matchStatus, input.score, input.movementId, input.paymentId),
    env.DB.prepare(
      `UPDATE payments
          SET status = 'recibido', reviewed_by = 'deuna', reviewed_at = ?, review_note = ?, updated_at = ?
        WHERE id = ? AND status IN ('en_revision', 'observado')
          AND EXISTS (SELECT 1 FROM bank_movements WHERE id = ? AND payment_id = ?)`,
    ).bind(input.now, confirmationNote(input.transactionNumber), input.now, input.paymentId, input.movementId, input.paymentId),
  ]);
  return Boolean(linked?.meta.changes);
}

// ---------------------------------------------------------------- admin API

const UUID_36 = /^[0-9a-f-]{36}$/;

async function findMovement(env: Env, id: string): Promise<BankMovementRow> {
  const row = await env.DB.prepare("SELECT * FROM bank_movements WHERE id = ?").bind(id).first<BankMovementRow>();
  if (!row) throw new HttpError(404, "not_found", "Movimiento no encontrado.");
  return row;
}

function mutationResponse(row: BankMovementRow): Response {
  return json({ ok: true, movement: toAdminMovement(row) } satisfies AdminMovementMutationResponse);
}

export async function listMovements(env: Env, status: string | null): Promise<Response> {
  if (status !== null && status !== "unmatched" && status !== "all") {
    throw new HttpError(400, "invalid_status", "Estado no válido.");
  }
  const query =
    status === "all"
      ? env.DB.prepare("SELECT * FROM bank_movements ORDER BY received_at DESC LIMIT ?").bind(MOVEMENTS_LIMIT)
      : env.DB.prepare("SELECT * FROM bank_movements WHERE match_status = 'unmatched' ORDER BY received_at DESC LIMIT ?").bind(MOVEMENTS_LIMIT);
  const { results } = await query.all<BankMovementRow>();
  return json({ movements: results.map(toAdminMovement) } satisfies AdminMovementsResponse);
}

export async function manualLink(request: Request, env: Env, movementId: string): Promise<Response> {
  const body = await readJson(request);
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  if (!UUID_36.test(paymentId)) throw new HttpError(400, "invalid_payment", "Pago no válido.");

  const movement = await findMovement(env, movementId);
  if (movement.payment_id) throw new HttpError(409, "movement_already_linked", "Este movimiento ya está vinculado a un pago.");

  const payment = await env.DB.prepare("SELECT id, status FROM payments WHERE id = ?").bind(paymentId).first<Pick<PaymentRow, "id" | "status">>();
  if (!payment) throw new HttpError(404, "not_found", "Pago no encontrado.");
  if (payment.status === "anulado") throw new HttpError(409, "payment_void", "El pago está anulado.");
  const taken = await env.DB.prepare("SELECT 1 AS taken FROM bank_movements WHERE payment_id = ?").bind(paymentId).first();
  if (taken) throw new HttpError(409, "payment_already_linked", "Este pago ya está vinculado a otro movimiento.");

  let linked: boolean;
  try {
    linked = await linkMovement(env, {
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
  return mutationResponse(await findMovement(env, movementId));
}

/** Detaches the movement from its payment. The payment keeps its current status: the treasurer decides. */
export async function unlinkMovement(env: Env, movementId: string): Promise<Response> {
  await findMovement(env, movementId);
  await env.DB.prepare("UPDATE bank_movements SET payment_id = NULL, match_status = 'unmatched', match_score = NULL WHERE id = ?").bind(movementId).run();
  console.log(JSON.stringify({ message: "movement unlinked", movementId }));
  return mutationResponse(await findMovement(env, movementId));
}

export async function ignoreMovement(env: Env, movementId: string): Promise<Response> {
  const movement = await findMovement(env, movementId);
  if (movement.payment_id) throw new HttpError(409, "movement_already_linked", "Desvincula el movimiento antes de ignorarlo.");
  await env.DB.prepare("UPDATE bank_movements SET match_status = 'ignored' WHERE id = ?").bind(movementId).run();
  console.log(JSON.stringify({ message: "movement ignored", movementId }));
  return mutationResponse(await findMovement(env, movementId));
}
