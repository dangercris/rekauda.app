import { daysLeftLabel, daysUntil, longDate, shortDate } from "../../lib/format";

export interface DeadlineInfo {
  /** Whole days left (Ecuador calendar); negative when past. */
  days: number;
  /** "Hasta el miércoles 2 de diciembre". */
  dateText: string;
  /** "mié 2 dic". */
  short: string;
  /** Sentence under the date: countdown, last day, past deadline or closed. */
  label: string;
  /** Three days or less left on an open collection. */
  urgent: boolean;
  /** Compact countdown for the hero chip ("Faltan 16 días"), null when closed. */
  chip: string | null;
}

export function deadlineInfo(deadline: string, open: boolean, now: Date = new Date()): DeadlineInfo {
  const days = daysUntil(deadline, now);
  let label: string;
  if (!open) label = "Recaudación cerrada";
  else if (days < 0) label = "El plazo terminó; aún puedes registrar tu pago";
  else if (days === 0) label = "Hoy es el último día";
  else if (days === 1) label = "Mañana es el último día";
  else label = `Faltan ${days} días`;
  return {
    days,
    dateText: `Hasta el ${longDate(deadline)}`,
    short: shortDate(deadline),
    label,
    urgent: open && days <= 3,
    chip: open ? daysLeftLabel(days) : null,
  };
}
