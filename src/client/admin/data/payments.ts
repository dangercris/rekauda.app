/**
 * Pure helpers over AdminPayment lists: counts, filters, search, day groups, review queue and the
 * activity feed. No React, no I/O: everything here is unit tested.
 */
import type { AdminPayment, PaymentStatus } from "../../../shared/api";
import { MONTHS_SHORT, WEEKDAYS_SHORT, daysUntil, ecParts, normalizeSearch, parseInstant, todayEc } from "../../lib/format";
import type { StatusFilter } from "../routes";

export type StatusCounts = Record<StatusFilter, number>;

export function countByStatus(payments: readonly AdminPayment[]): StatusCounts {
  const counts: StatusCounts = { todos: payments.length, en_revision: 0, recibido: 0, observado: 0, pagado: 0, anulado: 0 };
  for (const payment of payments) counts[payment.status] += 1;
  return counts;
}

export function studentName(student: { givenNames: string; surnames: string }): string {
  return `${student.givenNames} ${student.surnames}`.replace(/\s+/g, " ").trim();
}

/** "Ana Pérez, Luis Pérez" (or the representative when a legacy row has no students). */
export function studentNames(payment: AdminPayment): string {
  if (payment.students.length === 0) return payment.parentName;
  return payment.students.map(studentName).join(", ");
}

/** Distinct option labels in registration order: "Vestuario de mujer, Vestuario de hombre". */
export function optionLabels(payment: AdminPayment): string {
  return [...new Set(payment.students.map((s) => s.optionLabel))].join(", ");
}

/** Search by student, representative, code, phone or transfer reference (accent and case insensitive). */
export function matchesSearch(payment: AdminPayment, query: string): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  const haystack = normalizeSearch(
    [
      payment.code,
      payment.code.replace("-", ""),
      payment.parentName,
      payment.phone,
      payment.reference ?? "",
      ...payment.students.flatMap((s) => [studentName(s), s.optionLabel]),
    ].join(" "),
  );
  return needle.split(" ").every((word) => haystack.includes(word));
}

export function filterPayments(payments: readonly AdminPayment[], status: StatusFilter, query: string): AdminPayment[] {
  return payments.filter((p) => (status === "todos" || p.status === status) && matchesSearch(p, query));
}

export interface DayGroup {
  /** YYYY-MM-DD in Ecuador. */
  key: string;
  /** "Hoy", "Ayer", "Mar 24 nov", "24 nov 2025". */
  label: string;
  items: AdminPayment[];
}

function dayLabel(dayKey: string, now: Date): string {
  const days = daysUntil(dayKey, now);
  if (days === 0) return "Hoy";
  if (days === -1) return "Ayer";
  const instant = parseInstant(`${dayKey}T17:00:00Z`);
  if (!instant) return dayKey;
  const p = ecParts(instant);
  const sameYear = p.year === ecParts(now).year;
  const weekday = WEEKDAYS_SHORT[p.weekday] ?? "";
  const label = sameYear ? `${weekday} ${p.day} ${MONTHS_SHORT[p.month - 1] ?? ""}` : `${p.day} ${MONTHS_SHORT[p.month - 1] ?? ""} ${p.year}`;
  return label.charAt(0).toLocaleUpperCase("es") + label.slice(1);
}

/** Groups by registration day (Ecuador), keeping the incoming order inside each group. */
export function groupByDay(payments: readonly AdminPayment[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const payment of payments) {
    const instant = parseInstant(payment.createdAt);
    const key = instant ? todayEc(instant) : "sin-fecha";
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: instant ? dayLabel(key, now) : "Sin fecha", items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(payment);
  }
  return groups;
}

export interface PaymentFlag {
  key: "amountMismatch" | "duplicateReceipt" | "duplicateReference";
  label: string;
}

export function paymentFlags(payment: AdminPayment): PaymentFlag[] {
  const flags: PaymentFlag[] = [];
  if (payment.flags.amountMismatch) flags.push({ key: "amountMismatch", label: "Monto distinto" });
  if (payment.flags.duplicateReceipt) flags.push({ key: "duplicateReceipt", label: "Comprobante repetido" });
  if (payment.flags.duplicateReference) flags.push({ key: "duplicateReference", label: "Referencia repetida" });
  return flags;
}

/**
 * Next payment to review after acting on `currentId`: the next one with the same status the
 * representative was working on (list order, wrapping), else the oldest one still in review.
 */
export function nextInQueue(payments: readonly AdminPayment[], currentId: string, queue: PaymentStatus): string | null {
  const sameQueue = payments.filter((p) => p.status === queue || p.id === currentId);
  const index = sameQueue.findIndex((p) => p.id === currentId);
  const ordered = index >= 0 ? [...sameQueue.slice(index + 1), ...sameQueue.slice(0, index)] : sameQueue;
  const next = ordered.find((p) => p.id !== currentId && p.status === queue);
  if (next) return next.id;
  const review = payments.filter((p) => p.id !== currentId && p.status === "en_revision");
  return review.length > 0 ? (review[review.length - 1]?.id ?? null) : null;
}

/** Sum of amounts per status (non-void money in review, received...). */
export function centsWithStatus(payments: readonly AdminPayment[], status: PaymentStatus): number {
  return payments.reduce((sum, p) => (p.status === status ? sum + p.amountCents : sum), 0);
}

// ---------------------------------------------------------------- activity feed

export type ActivityKind = "created" | PaymentStatus;

export interface ActivityItem {
  id: string;
  paymentId: string;
  kind: ActivityKind;
  /** Who did it: the family, the representative or the automated reviewer. */
  actor: "family" | "admin" | "auto";
  at: string;
  /** Representative or student name shown in bold. */
  name: string;
  note: string | null;
}

/** Latest events (registration and last review of each payment), newest first. */
export function recentActivity(payments: readonly AdminPayment[], limit = 6): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const p of payments) {
    items.push({ id: `${p.id}:c`, paymentId: p.id, kind: "created", actor: "family", at: p.createdAt, name: p.parentName, note: null });
    if (p.reviewedAt) {
      items.push({
        id: `${p.id}:r`,
        paymentId: p.id,
        kind: p.status,
        actor: p.reviewedBy === "admin" ? "admin" : "auto",
        at: p.reviewedAt,
        name: studentNames(p),
        note: p.status === "observado" || p.status === "anulado" ? p.reviewNote : null,
      });
    }
  }
  const time = (value: string): number => parseInstant(value)?.getTime() ?? 0;
  return items.sort((a, b) => time(b.at) - time(a.at)).slice(0, limit);
}
