/**
 * Client-side mirror of the server rules in src/worker/validation.ts (personName, parsePhone,
 * parseTransferDate, parseAmount, parseReference, parseStudents). Problems are shown on each field before
 * the request is sent; the server stays the source of truth and its message is shown if it still rejects.
 */
import { parseAmountCents, todayEc } from "../../lib/format";

/** Same as the worker's cleanText: NFC, control chars to spaces, collapsed whitespace, trimmed. */
export function cleanText(raw: string, max: number): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

/** Normalized person name (curly apostrophes become straight ones), as the server stores it. */
export function normalizePersonName(raw: string): string {
  return cleanText(raw, 60).replace(/[’‘]/g, "'");
}

export function isPersonName(raw: string): boolean {
  const value = normalizePersonName(raw);
  return value.length >= 2 && value.length <= 60 && NAME_RE.test(value);
}

const EC_MOBILE_RE = /^(?:\+?5930?|0)?(9\d{8})$/;
const INTL_RE = /^\+\d{9,15}$/;

/** Ecuador mobile (09XXXXXXXX, +5939XXXXXXXX, 5939XXXXXXXX) or an international +number, like the server. */
export function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/[\s().-]/g, "");
  return EC_MOBILE_RE.test(digits) || INTL_RE.test(digits);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DateProblem = "missing" | "future" | "too_old" | null;

export function transferDateProblem(value: string, earliestTransferDate: string, now: Date = new Date()): DateProblem {
  if (!YMD_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return "missing";
  if (value > todayEc(now)) return "future";
  if (value < earliestTransferDate) return "too_old";
  return null;
}

export const MIN_AMOUNT_CENTS = 100;
export const MAX_AMOUNT_CENTS = 600_000;

export type AmountProblem = "invalid" | "range" | null;

export function amountProblem(raw: string): AmountProblem {
  const cents = parseAmountCents(raw);
  if (cents === null) return "invalid";
  if (cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) return "range";
  return null;
}

const REFERENCE_RE = /^[\p{L}\p{N} ./#-]+$/u;

export function isValidReference(raw: string): boolean {
  const value = cleanText(raw, 40);
  return value === "" || REFERENCE_RE.test(value);
}

/** Lowercase, no diacritics, single spaces (duplicate student detection, like the server). */
export function normalizeForCompare(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- whole form

export interface StudentValues {
  givenNames: string;
  surnames: string;
  option: string | null;
}

export interface PaymentValues {
  students: readonly StudentValues[];
  hasReceipt: boolean;
  amount: string;
  transferDate: string;
  bank: string;
  reference: string;
  parentName: string;
  phone: string;
  consent: boolean;
}

export interface ValidationContext {
  optionKeys: readonly string[];
  /** The tenant's bank list. */
  banks: readonly string[];
  /** The tenant's earliest accepted transfer date (YYYY-MM-DD) and its Spanish month and year for messages. */
  earliestTransferDate: string;
  earliestTransferLabel: string;
  now?: Date | undefined;
}

export type StudentField = "givenNames" | "surnames" | "option";
export type FieldKey =
  | `students.${number}.${StudentField}`
  | "receipt"
  | "amount"
  | "transferDate"
  | "bank"
  | "reference"
  | "parentName"
  | "phone"
  | "consent";

export interface ValidationIssue {
  field: FieldKey;
  /** Shown under the field. */
  message: string;
  /** Shown in the error summary (names the field). */
  summary: string;
}

export const studentField = (index: number, field: StudentField): FieldKey => `students.${index}.${field}`;

export type FormField = Exclude<FieldKey, `students.${number}.${StudentField}`>;
const FORM_FIELDS: readonly string[] = ["receipt", "amount", "transferDate", "bank", "reference", "parentName", "phone", "consent"];
const STUDENT_FIELD_RE = /^students\.\d+\.(givenNames|surnames|option)$/;

export function isFormField(value: string): value is FormField {
  return FORM_FIELDS.includes(value);
}

export function isFieldKey(value: string): value is FieldKey {
  return isFormField(value) || STUDENT_FIELD_RE.test(value);
}

/** Entries of a field-error map in insertion (form) order, typed. */
export function errorEntries(errors: Partial<Record<FieldKey, string>>): Array<[FieldKey, string]> {
  const out: Array<[FieldKey, string]> = [];
  for (const [key, message] of Object.entries(errors)) {
    if (message !== undefined && isFieldKey(key)) out.push([key, message]);
  }
  return out;
}

function studentName(index: number, total: number): string {
  return total > 1 ? `del estudiante ${index + 1}` : "del estudiante";
}

/** Every problem in form order (the first one gets the focus). Empty array means the form can be sent. */
export function validatePayment(values: PaymentValues, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: FieldKey, message: string, summary: string) => issues.push({ field, message, summary });
  const total = values.students.length;
  const seen = new Set<string>();

  values.students.forEach((student, index) => {
    const who = studentName(index, total);
    const givenOk = isPersonName(student.givenNames);
    const surnamesOk = isPersonName(student.surnames);
    if (!givenOk) add(studentField(index, "givenNames"), "Escribe los nombres, solo con letras.", `Revisa los nombres ${who}.`);
    if (!surnamesOk) add(studentField(index, "surnames"), "Escribe los apellidos, solo con letras.", `Revisa los apellidos ${who}.`);
    if (student.option === null || !ctx.optionKeys.includes(student.option)) {
      add(studentField(index, "option"), "Elige una opción.", `Elige la opción ${who}.`);
    }
    if (givenOk && surnamesOk) {
      const key = normalizeForCompare(`${normalizePersonName(student.givenNames)} ${normalizePersonName(student.surnames)}`);
      if (seen.has(key)) add(studentField(index, "givenNames"), "Este estudiante ya está en la lista.", `El estudiante ${index + 1} está repetido.`);
      seen.add(key);
    }
  });

  if (!values.hasReceipt) add("receipt", "Adjunta la captura o el PDF del comprobante.", "Adjunta el comprobante de la transferencia.");

  const amount = amountProblem(values.amount);
  if (amount === "invalid") add("amount", "Escribe el monto con números, por ejemplo 14,00.", "Escribe el monto transferido.");
  else if (amount === "range") add("amount", "El monto transferido no parece correcto.", "Revisa el monto transferido.");

  const date = transferDateProblem(values.transferDate, ctx.earliestTransferDate, ctx.now);
  if (date === "missing") add("transferDate", "Elige la fecha.", "Escribe la fecha de la transferencia.");
  else if (date === "future") add("transferDate", "La fecha no puede ser futura.", "La fecha de la transferencia no puede ser futura.");
  else if (date === "too_old") add("transferDate", `La fecha no puede ser anterior a ${ctx.earliestTransferLabel}.`, "Revisa la fecha de la transferencia.");

  if (!values.bank || !ctx.banks.includes(values.bank)) {
    add("bank", "Elige tu banco o cooperativa.", "Elige el banco desde el que transferiste.");
  }

  if (!isValidReference(values.reference)) {
    add("reference", "Solo letras, números y los signos . / # -", "Revisa el número de comprobante.");
  }

  if (!isPersonName(values.parentName)) add("parentName", "Escribe tu nombre y apellido.", "Escribe el nombre del representante.");
  if (!isValidPhone(values.phone)) add("phone", "Escribe un celular válido, por ejemplo 0991234567.", "Escribe un celular válido.");
  if (!values.consent) add("consent", "Marca la autorización para continuar.", "Marca la autorización para usar tus datos.");

  return issues;
}

/** Summary sentence like the current site: the single problem, or the count plus the first one. */
export function summarize(issues: readonly ValidationIssue[]): string {
  const first = issues[0];
  if (!first) return "";
  return issues.length === 1 ? first.summary : `Revisa ${issues.length} campos marcados. ${first.summary}`;
}
