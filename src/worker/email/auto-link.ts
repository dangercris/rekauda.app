/**
 * Automatic linking in both arrival orders:
 * - the Deuna mail arrives after the family registered the payment (autoLinkMovement, from the email handler);
 * - the family registers the payment after the mail arrived (autoLinkPayment, from createPayment).
 * Both use the same pure rules (src/shared/match.ts) and the same guarded batch (linkMovement).
 * Everything here is best-effort: callers log failures and never let them break the main flow.
 */
import type { TenantDb } from "../data/tenant-db";
import { linkMovement } from "../movements";
import type { BankMovementRow } from "../rows";
import { ecuadorDay, pickMatch, type MatchCandidate, type MatchMovement } from "./match";

export const CANDIDATE_WINDOW_DAYS = 45;

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ message, ...fields }));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Payments that could still be confirmed by a transfer of `amountCents`: open, recent and not linked yet. */
export async function loadCandidates(db: TenantDb, now: string, amountCents: number): Promise<MatchCandidate[]> {
  const since = new Date(new Date(now).getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000).toISOString();
  const { results: payments } = await db
    .prepare(
      `SELECT p.id, p.parent_name, p.amount_cents, p.transfer_date, p.bank
         FROM payments p
        WHERE p.tenant_id = ?1
          AND p.status IN ('en_revision', 'recibido', 'observado')
          AND p.created_at >= ?2
          AND p.amount_cents = ?3
          AND NOT EXISTS (SELECT 1 FROM bank_movements m WHERE m.tenant_id = ?1 AND m.payment_id = p.id)`,
    )
    .bind(since, amountCents)
    .all<{ id: string; parent_name: string; amount_cents: number; transfer_date: string; bank: string }>();
  if (payments.length === 0) return [];

  const { results: students } = await db
    .prepare(
      `SELECT s.payment_id, s.surnames FROM students s JOIN payments p ON p.id = s.payment_id AND p.tenant_id = ?1
        WHERE s.tenant_id = ?1 AND p.status IN ('en_revision', 'recibido', 'observado') AND p.created_at >= ?2 AND p.amount_cents = ?3`,
    )
    .bind(since, amountCents)
    .all<{ payment_id: string; surnames: string }>();
  const surnames = new Map<string, string[]>();
  for (const s of students) surnames.set(s.payment_id, [...(surnames.get(s.payment_id) ?? []), s.surnames]);

  return payments.map((p) => ({
    id: p.id,
    parentName: p.parent_name,
    amountCents: p.amount_cents,
    transferDate: p.transfer_date,
    bank: p.bank,
    studentSurnames: surnames.get(p.id) ?? [],
  }));
}

export interface MovementFacts extends MatchMovement {
  transactionNumber: string;
}

/** Mail first, payment already there: link the movement to the one payment that clearly fits. */
/** Returns the payment id when it linked, null otherwise. */
export async function autoLinkMovement(db: TenantDb, movementId: string, facts: MovementFacts, now: string): Promise<string | null> {
  const candidates = await loadCandidates(db, now, facts.amountCents);
  const match = pickMatch(facts, candidates);
  if (!match) {
    log("deuna_mail_unmatched", { transaction: facts.transactionNumber, candidates: candidates.length, day: ecuadorDay(facts.receivedAt) });
    return null;
  }
  try {
    const linked = await linkMovement(db, {
      movementId,
      paymentId: match.paymentId,
      transactionNumber: facts.transactionNumber,
      matchStatus: "auto",
      score: match.score,
      now,
    });
    log(linked ? "deuna_mail_matched" : "deuna_mail_link_skipped", { transaction: facts.transactionNumber, paymentId: match.paymentId, score: match.score });
    return linked ? match.paymentId : null;
  } catch (e) {
    // Most likely the payment was linked to another movement meanwhile: leave this one for the treasurer.
    log("deuna_mail_link_failed", { transaction: facts.transactionNumber, error: errorText(e) });
    return null;
  }
}

/**
 * Payment registered after the transfer: link it when exactly one unmatched movement clearly points to it.
 * Each movement is judged against ALL competing payments, so a movement that fits two families stays unmatched.
 * Never throws: a failure is logged and the payment registration goes on.
 */
export async function autoLinkPayment(db: TenantDb, paymentId: string, amountCents: number, now: string): Promise<void> {
  try {
    const { results: movements } = await db
      .prepare(
        "SELECT * FROM bank_movements WHERE tenant_id = ?1 AND match_status = 'unmatched' AND payment_id IS NULL AND amount_cents = ?2 ORDER BY received_at DESC LIMIT 50",
      )
      .bind(amountCents)
      .all<BankMovementRow>();
    if (movements.length === 0) return;

    const candidates = await loadCandidates(db, now, amountCents);
    const pointing = movements.filter(
      (m) =>
        pickMatch({ amountCents: m.amount_cents, receivedAt: m.received_at, payerName: m.payer_name, originBank: m.origin_bank }, candidates)?.paymentId ===
        paymentId,
    );
    const [only] = pointing;
    if (pointing.length !== 1 || !only) {
      if (pointing.length > 1) log("payment_movement_ambiguous", { paymentId, movements: pointing.length });
      return;
    }
    const match = pickMatch(
      { amountCents: only.amount_cents, receivedAt: only.received_at, payerName: only.payer_name, originBank: only.origin_bank },
      candidates,
    );
    const linked = await linkMovement(db, {
      movementId: only.id,
      paymentId,
      transactionNumber: only.transaction_number,
      matchStatus: "auto",
      score: match?.score ?? null,
      now,
    });
    log(linked ? "payment_movement_matched" : "payment_movement_link_skipped", { paymentId, transaction: only.transaction_number });
  } catch (e) {
    console.error(JSON.stringify({ message: "payment_movement_match_failed", paymentId, error: errorText(e) }));
  }
}
