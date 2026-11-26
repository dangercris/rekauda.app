import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AdminPayment, PaymentStatus } from "../../../shared/api";
import { errorMessage, setPaymentStatus } from "../../lib/api";
import { useApiErrorGate } from "../session/SessionContext";

export type ActionResult = { ok: true } | { ok: false; message: string | null };

export interface PaymentActionsApi {
  /**
   * Optimistic status change: the row updates at once and rolls back if the server rejects it.
   * `note` is required by the server for observado and anulado (shown to the family).
   */
  setStatus: (payment: AdminPayment, status: PaymentStatus, note?: string | undefined) => Promise<ActionResult>;
  /** Id of the payment with a request in flight. */
  pendingId: string | null;
}

export function needsNote(status: PaymentStatus): boolean {
  return status === "observado" || status === "anulado";
}

/** Local projection of what the Worker writes on a status change (src/worker/admin.ts updateStatus). */
export function applyStatus(payment: AdminPayment, status: PaymentStatus, note: string | undefined, now: string): AdminPayment {
  const trimmed = note?.trim() ?? "";
  return {
    ...payment,
    status,
    reviewNote: trimmed ? trimmed : payment.reviewNote,
    reviewedBy: "admin",
    reviewedAt: now,
    paidAt: status === "pagado" ? now : null,
  };
}

interface Options {
  setPayments: Dispatch<SetStateAction<AdminPayment[]>>;
  /** Called after a successful change (refresh stats, flags). */
  onChanged?: (() => void) | undefined;
}

export function usePaymentActions({ setPayments, onChanged }: Options): PaymentActionsApi {
  const gate = useApiErrorGate();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const setStatus = useCallback<PaymentActionsApi["setStatus"]>(
    async (payment, status, note) => {
      if (needsNote(status) && !note?.trim()) {
        return { ok: false, message: "Escribe el motivo para que la familia sepa qué corregir." };
      }
      if (inFlight.current.has(payment.id)) return { ok: false, message: null };
      inFlight.current.add(payment.id);
      setPendingId(payment.id);
      const optimistic = applyStatus(payment, status, note, new Date().toISOString());
      setPayments((list) => list.map((p) => (p.id === payment.id ? optimistic : p)));
      try {
        const updated = await setPaymentStatus(payment.id, note?.trim() ? { status, note: note.trim() } : { status });
        if (updated) setPayments((list) => list.map((p) => (p.id === payment.id ? updated : p)));
        onChanged?.();
        return { ok: true };
      } catch (caught) {
        // Roll back only if nothing newer replaced the optimistic row meanwhile.
        setPayments((list) => list.map((p) => (p.id === payment.id && p === optimistic ? payment : p)));
        if (gate(caught)) return { ok: false, message: null };
        return { ok: false, message: errorMessage(caught) };
      } finally {
        inFlight.current.delete(payment.id);
        setPendingId((current) => (current === payment.id ? null : current));
      }
    },
    [gate, onChanged, setPayments],
  );

  return { setStatus, pendingId };
}
