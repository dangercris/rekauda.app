/** Pure helpers for the Deuna movements screen. */
import type { AdminBankMovement, AdminPayment } from "../../../shared/api";
import { scoreCandidate, type MatchCandidate } from "../../../shared/match";
import { studentName } from "./payments";

export function toCandidate(payment: AdminPayment): MatchCandidate {
  return {
    id: payment.id,
    parentName: payment.parentName,
    amountCents: payment.amountCents,
    transferDate: payment.transferDate,
    bank: payment.bank,
    studentSurnames: payment.students.map((s) => s.surnames),
  };
}

export interface RankedPayment {
  payment: AdminPayment;
  /** 0..1, or null when the declared date is far from the movement (still selectable). */
  score: number | null;
}

/**
 * Payments the treasurer can link a movement to: same amount, not void, not linked to another movement.
 * Best match first (same rules the Worker uses to auto-link), then the most recent registration.
 */
export function candidatePayments(movement: AdminBankMovement, payments: readonly AdminPayment[]): RankedPayment[] {
  const movementInput = {
    amountCents: movement.amountCents,
    receivedAt: movement.receivedAt,
    payerName: movement.payerName,
    originBank: movement.originBank,
  };
  return payments
    .filter((p) => p.amountCents === movement.amountCents && p.status !== "anulado" && p.bankMovement === null)
    .map((payment) => ({ payment, score: scoreCandidate(movementInput, toCandidate(payment)) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.payment.createdAt.localeCompare(a.payment.createdAt));
}

/** "Carolina Vásquez · Mateo Andrade · 25 nov" style label for the select. */
export function candidateLabel(ranked: RankedPayment, formatDate: (iso: string) => string): string {
  const { payment } = ranked;
  const students = payment.students.map(studentName).join(", ");
  const parts = [payment.parentName, students, formatDate(payment.transferDate), payment.code];
  return parts.filter(Boolean).join(" · ");
}
