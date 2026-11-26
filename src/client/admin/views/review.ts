/**
 * Review rules for the verify screen: which status changes are offered for each status (same set as
 * the previous admin), which two are primary, labels, preset reasons and the automatic checks.
 */
import type { AdminCollection, AdminPayment, PaymentStatus } from "../../../shared/api";
import { daysUntil, formatMoney, longDate } from "../../lib/format";

export const ACTION_LABEL: Record<PaymentStatus, string> = {
  recibido: "Comprobante recibido",
  pagado: "Marcar pagado",
  observado: "Observar…",
  en_revision: "Volver a revisión",
  anulado: "Anular…",
};

export const DONE_MESSAGE: Record<PaymentStatus, string> = {
  recibido: "Comprobante recibido.",
  pagado: "Pago confirmado.",
  observado: "Pago observado. La familia verá el motivo con su código.",
  en_revision: "El pago volvió a revisión.",
  anulado: "Registro anulado.",
};

/** Status changes offered for a payment (parity with the previous admin). */
export function allowedActions(status: PaymentStatus): PaymentStatus[] {
  const out: PaymentStatus[] = [];
  if (status !== "recibido" && status !== "pagado") out.push("recibido");
  if (status !== "pagado") out.push("pagado");
  if (status !== "observado") out.push("observado");
  if (status !== "en_revision") out.push("en_revision");
  if (status !== "anulado") out.push("anulado");
  return out;
}

const PRIMARY: Record<PaymentStatus, PaymentStatus[]> = {
  en_revision: ["observado", "recibido"],
  recibido: ["observado", "pagado"],
  observado: ["en_revision", "recibido"],
  pagado: ["en_revision"],
  anulado: ["en_revision"],
};

/** The (up to) two actions in the sticky bar; the rest go under "Otras acciones". */
export function splitActions(status: PaymentStatus): { primary: PaymentStatus[]; secondary: PaymentStatus[] } {
  const allowed = allowedActions(status);
  const primary = PRIMARY[status].filter((s) => allowed.includes(s));
  return { primary, secondary: allowed.filter((s) => !primary.includes(s)) };
}

export interface ReasonPreset {
  label: string;
  note: string;
}

export function reasonPresets(status: "observado" | "anulado", payment: AdminPayment): ReasonPreset[] {
  if (status === "anulado") {
    return [
      { label: "Registro duplicado", note: "Este registro está duplicado. Se mantiene el otro registro del mismo pago." },
      { label: "Pago devuelto", note: "El pago fue devuelto a la cuenta de origen." },
      { label: "Registrado por error", note: "El registro se hizo por error y fue anulado." },
    ];
  }
  const short = payment.amountCents < payment.expectedCents;
  return [
    {
      label: short ? "Monto incompleto" : "Monto distinto",
      note: short
        ? `El monto transferido (${formatMoney(payment.amountCents)}) es menor al esperado (${formatMoney(payment.expectedCents)}). Transfiere la diferencia y registra el comprobante.`
        : `El monto transferido (${formatMoney(payment.amountCents)}) no coincide con el esperado (${formatMoney(payment.expectedCents)}). Escríbenos para revisarlo.`,
    },
    { label: "Comprobante ilegible", note: "No se puede leer el comprobante. Sube una captura de pantalla más clara." },
    { label: "Transacción repetida", note: "Este comprobante ya fue registrado en otro pago. Revisa si subiste el archivo correcto." },
    { label: "No llegó al banco", note: "La transferencia todavía no aparece en la cuenta. Revisa con tu banco si se completó." },
  ];
}

export interface Check {
  key: string;
  tone: "ok" | "warn" | "bad";
  title: string;
  detail: string;
}

/** Automatic checks from the server flags and the collection deadline. */
export function automaticChecks(payment: AdminPayment, collection: AdminCollection | null): Check[] {
  const checks: Check[] = [];
  const amounts = `Esperado ${formatMoney(payment.expectedCents)} · recibido ${formatMoney(payment.amountCents)}`;
  if (!payment.flags.amountMismatch) checks.push({ key: "amount", tone: "ok", title: "El monto coincide", detail: amounts });
  else if (payment.amountCents < payment.expectedCents) checks.push({ key: "amount", tone: "bad", title: "Monto menor al esperado", detail: amounts });
  else checks.push({ key: "amount", tone: "warn", title: "Monto mayor al esperado", detail: amounts });

  if (payment.flags.duplicateReceipt) {
    checks.push({ key: "receipt", tone: "bad", title: "Comprobante repetido", detail: "El mismo archivo está en otro registro que no fue anulado." });
  } else {
    checks.push({ key: "receipt", tone: "ok", title: "Comprobante único", detail: "El archivo no se repite en otros registros." });
  }

  if (!payment.reference) {
    checks.push({ key: "reference", tone: "warn", title: "Sin número de comprobante", detail: "La familia no escribió el número de la transacción." });
  } else if (payment.flags.duplicateReference) {
    checks.push({ key: "reference", tone: "bad", title: "Referencia repetida", detail: `${payment.reference} aparece en otro pago.` });
  } else {
    checks.push({ key: "reference", tone: "ok", title: "Referencia única", detail: `${payment.reference} no aparece en otros pagos.` });
  }

  if (collection) {
    const days = daysUntil(collection.deadline, new Date(`${payment.transferDate}T17:00:00Z`));
    if (!Number.isNaN(days)) {
      if (days >= 0) {
        checks.push({
          key: "deadline",
          tone: "ok",
          title: "Dentro del plazo",
          detail: days === 0 ? "Transferido el último día del plazo." : `Transferido ${days === 1 ? "1 día" : `${days} días`} antes del límite.`,
        });
      } else {
        checks.push({ key: "deadline", tone: "warn", title: "Después del plazo", detail: `El límite era el ${longDate(collection.deadline)}.` });
      }
    }
  }
  return checks;
}
