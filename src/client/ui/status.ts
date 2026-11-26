import type { PaymentStatus } from "../../shared/api";
import type { IconName } from "./Icon";

export type StatusTone = "warn" | "info" | "bad" | "ok" | "void";

export interface StatusMeta {
  /** Family-facing label. */
  label: string;
  tone: StatusTone;
  icon: IconName;
  /** One-line explanation for families (status lookup, timeline). */
  description: string;
}

/**
 * Payment status presentation. Color is never the only signal: every status has a label and an icon.
 * recibido uses a calm blue (info) rather than the event tone so it reads the same in multi-event lists.
 */
export const STATUS_META: Readonly<Record<PaymentStatus, StatusMeta>> = {
  en_revision: {
    label: "En revisión",
    tone: "warn",
    icon: "clock",
    description: "La tesorería revisará tu comprobante.",
  },
  recibido: {
    label: "Recibido",
    tone: "info",
    icon: "mail",
    description: "La tesorería recibió tu comprobante y lo está cruzando con el banco.",
  },
  observado: {
    label: "Con observación",
    tone: "bad",
    icon: "alert-circle",
    description: "Hay algo por corregir en tu pago.",
  },
  pagado: {
    label: "Pagado",
    tone: "ok",
    icon: "check",
    description: "Tu pago quedó confirmado.",
  },
  anulado: {
    label: "Anulado",
    tone: "void",
    icon: "x",
    description: "Este registro fue anulado.",
  },
};
