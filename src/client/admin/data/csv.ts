/**
 * "Exportar para Excel (CSV)": the visible payments as a semicolon-separated file with a UTF-8 BOM,
 * which is what Excel opens correctly with an Ecuadorian (comma decimal) locale.
 */
import type { AdminPayment } from "../../../shared/api";
import { STATUS_META } from "../../ui";
import { dateTime, moneyParts, todayEc } from "../../lib/format";
import { studentName } from "./payments";

const HEADERS = [
  "Código",
  "Estado",
  "Estudiantes",
  "Opciones",
  "Representante",
  "Celular",
  "Monto",
  "Esperado",
  "Fecha de transferencia",
  "Banco",
  "Referencia",
  "Registrado",
  "Revisado",
  "Pagado",
  "Nota para la familia",
  "Alertas",
] as const;

/** "1696,00": no currency sign or thousands separator so Excel reads it as a number. */
function amount(cents: number): string {
  const p = moneyParts(cents);
  return `${p.negative ? "-" : ""}${p.int.replace(/\./g, "")},${p.cents}`;
}

function cell(value: string): string {
  // Neutralize spreadsheet formulas (CSV injection) and quote everything that needs it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function paymentsCsv(payments: readonly AdminPayment[]): string {
  const rows = payments.map((p) => {
    const alerts = [
      p.flags.amountMismatch ? "Monto distinto" : "",
      p.flags.duplicateReceipt ? "Comprobante repetido" : "",
      p.flags.duplicateReference ? "Referencia repetida" : "",
    ].filter(Boolean);
    return [
      p.code,
      STATUS_META[p.status].label,
      p.students.map(studentName).join(" | "),
      p.students.map((s) => s.optionLabel).join(" | "),
      p.parentName,
      p.phone,
      amount(p.amountCents),
      amount(p.expectedCents),
      p.transferDate,
      p.bank,
      p.reference ?? "",
      dateTime(p.createdAt),
      p.reviewedAt ? dateTime(p.reviewedAt) : "",
      p.paidAt ? dateTime(p.paidAt) : "",
      p.reviewNote ?? "",
      alerts.join(" | "),
    ];
  });
  return `﻿${[HEADERS, ...rows].map((row) => row.map((v) => cell(v)).join(";")).join("\r\n")}\r\n`;
}

export function csvFileName(slug: string | null, now: Date = new Date()): string {
  return `pagos-${slug ?? "todos"}-${todayEc(now)}.csv`;
}

/** Triggers the download in the browser. Returns false when the browser cannot create the file. */
export function downloadCsv(content: string, fileName: string): boolean {
  if (typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
