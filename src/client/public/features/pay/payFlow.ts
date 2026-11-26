/**
 * Pay flow state (pure): step, student blocks, form fields, receipt, validation and submission.
 * The component layer (usePayFlow) wires side effects: uploads, focus, storage.
 */
import type { CollectionOption } from "../../../../shared/api";
import { formatMoney, parseAmountCents, plainAmount } from "../../../lib/format";
import { expectedTotal, optionLabel, type ExpectedTotal } from "../../lib/pricing";
import type { FieldKey, PaymentValues, StudentField, StudentValues, ValidationIssue } from "../../lib/validation";

export type PayStep = 1 | 2 | 3;

export interface StudentDraft extends StudentValues {
  /** Stable React key; never sent. */
  id: number;
}

export interface PayFields {
  amount: string;
  /** True once the person typed an amount: stops the auto-fill with the expected total. */
  amountTouched: boolean;
  transferDate: string;
  bank: string;
  reference: string;
  parentName: string;
  phone: string;
  consent: boolean;
}

export type EditableField = Exclude<keyof PayFields, "amountTouched" | "consent">;

export type ReceiptState = { file: File; status: "processing" | "ready" } | null;

export interface PayResult {
  code: string;
  students: StudentValues[];
  amountCents: number;
}

export interface PayState {
  step: PayStep;
  /** Direction of the last step change, for the enter animation. */
  direction: "forward" | "back" | "none";
  /** "¿Por cuántos estudiantes pagas?" (step 1). Follows the real block count once in step 2. */
  count: number;
  students: StudentDraft[];
  nextId: number;
  fields: PayFields;
  receipt: ReceiptState;
  /** Receipt problem found while preparing the file (decode failure, too big after compression). */
  receiptError: string | null;
  errors: Partial<Record<FieldKey, string>>;
  /** Error summary sentence, shown after a submit attempt with problems. */
  summary: string | null;
  submitting: boolean;
  serverError: string | null;
  result: PayResult | null;
  /** maxPerPayment of the collection. */
  max: number;
  /** Auto-selected option key when the collection has a single option. */
  singleOption: string | null;
}

// ---------------------------------------------------------------- draft (sessionStorage)

export interface PayDraft {
  v: 1;
  step: 1 | 2;
  count: number;
  students: StudentValues[];
  fields: PayFields;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStr = (value: unknown): value is string => typeof value === "string";

function isStudentValues(value: unknown): value is StudentValues {
  return isRecord(value) && isStr(value["givenNames"]) && isStr(value["surnames"]) && (value["option"] === null || isStr(value["option"]));
}

function isPayFields(value: unknown): value is PayFields {
  if (!isRecord(value)) return false;
  const strings = ["amount", "transferDate", "bank", "reference", "parentName", "phone"];
  return strings.every((k) => isStr(value[k])) && typeof value["amountTouched"] === "boolean" && typeof value["consent"] === "boolean";
}

export function isPayDraft(value: unknown): value is PayDraft {
  return (
    isRecord(value) &&
    value["v"] === 1 &&
    (value["step"] === 1 || value["step"] === 2) &&
    typeof value["count"] === "number" &&
    Array.isArray(value["students"]) &&
    value["students"].every(isStudentValues) &&
    isPayFields(value["fields"])
  );
}

export const draftKey = (slug: string): string => `draft:${slug}`;

export function toDraft(state: PayState): PayDraft {
  return {
    v: 1,
    step: state.step === 2 ? 2 : 1,
    count: state.count,
    students: state.students.map(({ givenNames, surnames, option }) => ({ givenNames, surnames, option })),
    fields: state.fields,
  };
}

// ---------------------------------------------------------------- init

export interface PayInit {
  options: readonly CollectionOption[];
  maxPerPayment: number;
  /** Today in Ecuador (YYYY-MM-DD): default and max of the transfer date. */
  today: string;
  draft?: PayDraft | null | undefined;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(n) || min));

function emptyFields(today: string): PayFields {
  return { amount: "", amountTouched: false, transferDate: today, bank: "", reference: "", parentName: "", phone: "", consent: false };
}

export function initPayState({ options, maxPerPayment, today, draft }: PayInit): PayState {
  const max = Math.max(1, maxPerPayment);
  const singleOption = options.length === 1 ? (options[0]?.key ?? null) : null;
  const keys = new Set(options.map((o) => o.key));
  const restored = (draft?.students ?? []).slice(0, max);
  const students: StudentDraft[] = (restored.length ? restored : [{ givenNames: "", surnames: "", option: null }]).map((s, i) => ({
    id: i + 1,
    givenNames: s.givenNames,
    surnames: s.surnames,
    option: singleOption ?? (s.option !== null && keys.has(s.option) ? s.option : null),
  }));
  const fields = draft ? { ...draft.fields } : emptyFields(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.transferDate) || fields.transferDate > today) fields.transferDate = today;
  if (!fields.amountTouched) fields.amount = "";
  return {
    step: draft?.step ?? 1,
    direction: "none",
    count: clamp(draft?.count ?? 1, 1, max),
    students,
    nextId: students.length + 1,
    fields,
    receipt: null,
    receiptError: null,
    errors: {},
    summary: null,
    submitting: false,
    serverError: null,
    result: null,
    max,
    singleOption,
  };
}

// ---------------------------------------------------------------- reducer

export type PayAction =
  | { type: "setCount"; count: number }
  | { type: "goTo"; step: 1 | 2 }
  | { type: "addStudent" }
  | { type: "removeStudent"; id: number }
  | { type: "updateStudent"; id: number; field: StudentField; value: string }
  | { type: "setField"; field: EditableField; value: string }
  | { type: "setConsent"; value: boolean }
  | { type: "receiptProcessing"; file: File }
  | { type: "receiptReady"; file: File }
  | { type: "receiptFailed"; message: string }
  | { type: "receiptCleared" }
  | { type: "invalid"; issues: readonly ValidationIssue[]; summary: string }
  | { type: "submitStart" }
  | { type: "submitSuccess"; result: PayResult; today: string }
  | { type: "submitFailure"; message: string }
  | { type: "startAnother" };

const isEmptyStudent = (s: StudentValues): boolean => !s.givenNames.trim() && !s.surnames.trim();

function newStudent(state: PayState): StudentDraft {
  return { id: state.nextId, givenNames: "", surnames: "", option: state.singleOption };
}

/**
 * Entering step 2: add blocks up to the counter, drop trailing EMPTY blocks above it (never filled ones),
 * then the counter follows the real block count.
 */
export function syncStudentsToCount(state: PayState): PayState {
  const students = [...state.students];
  let nextId = state.nextId;
  while (students.length < state.count) {
    students.push({ id: nextId, givenNames: "", surnames: "", option: state.singleOption });
    nextId += 1;
  }
  for (let i = students.length - 1; i >= state.count && students.length > 1; i -= 1) {
    const student = students[i];
    if (student && isEmptyStudent(student)) students.splice(i, 1);
  }
  return { ...state, students, nextId, count: students.length };
}

function withoutErrors(state: PayState, keys: readonly FieldKey[]): Pick<PayState, "errors" | "summary"> {
  if (keys.every((k) => state.errors[k] === undefined)) return { errors: state.errors, summary: state.summary };
  const errors = { ...state.errors };
  for (const k of keys) delete errors[k];
  return { errors, summary: Object.keys(errors).length ? state.summary : null };
}

function withoutStudentErrors(state: PayState): Pick<PayState, "errors" | "summary"> {
  const keys = Object.keys(state.errors).filter((k): k is FieldKey => k.startsWith("students."));
  return withoutErrors(state, keys);
}

export function payReducer(state: PayState, action: PayAction): PayState {
  switch (action.type) {
    case "setCount":
      return { ...state, count: clamp(action.count, 1, state.max) };
    case "goTo": {
      if (action.step === state.step) return state;
      const direction = action.step > state.step ? "forward" : "back";
      const base = action.step === 2 && state.step === 1 ? syncStudentsToCount(state) : state;
      return { ...base, step: action.step, direction, serverError: null };
    }
    case "addStudent": {
      if (state.students.length >= state.max) return state;
      const students = [...state.students, newStudent(state)];
      return { ...state, students, nextId: state.nextId + 1, count: students.length };
    }
    case "removeStudent": {
      if (state.students.length <= 1) return state;
      const students = state.students.filter((s) => s.id !== action.id);
      return { ...state, ...withoutStudentErrors(state), students, count: students.length };
    }
    case "updateStudent": {
      const index = state.students.findIndex((s) => s.id === action.id);
      if (index < 0) return state;
      const students = state.students.map((s) => (s.id === action.id ? { ...s, [action.field]: action.value } : s));
      return { ...state, ...withoutErrors(state, [`students.${index}.${action.field}`]), students };
    }
    case "setField": {
      const fields: PayFields = { ...state.fields, [action.field]: action.value };
      if (action.field === "amount") fields.amountTouched = true;
      return { ...state, ...withoutErrors(state, [action.field]), fields };
    }
    case "setConsent":
      return { ...state, ...withoutErrors(state, ["consent"]), fields: { ...state.fields, consent: action.value } };
    case "receiptProcessing":
      return { ...state, ...withoutErrors(state, ["receipt"]), receipt: { file: action.file, status: "processing" }, receiptError: null };
    case "receiptReady":
      return { ...state, ...withoutErrors(state, ["receipt"]), receipt: { file: action.file, status: "ready" }, receiptError: null };
    case "receiptFailed":
      // A failed replacement never keeps the previous (stale) file.
      return { ...state, receipt: null, receiptError: action.message };
    case "receiptCleared":
      return { ...state, ...withoutErrors(state, ["receipt"]), receipt: null, receiptError: null };
    case "invalid": {
      const errors: Partial<Record<FieldKey, string>> = {};
      for (const issue of action.issues) errors[issue.field] ??= issue.message;
      return { ...state, errors, summary: action.summary, serverError: null };
    }
    case "submitStart":
      return { ...state, submitting: true, serverError: null, summary: null };
    case "submitFailure":
      return { ...state, submitting: false, serverError: action.message };
    case "submitSuccess": {
      // Keep the representative's details: a parent paying for another child should not retype them.
      const keep = { parentName: state.fields.parentName, phone: state.fields.phone, bank: state.fields.bank };
      return {
        ...state,
        step: 3,
        direction: "forward",
        submitting: false,
        serverError: null,
        result: action.result,
        count: 1,
        students: [{ id: state.nextId, givenNames: "", surnames: "", option: state.singleOption }],
        nextId: state.nextId + 1,
        fields: { ...emptyFields(action.today), ...keep },
        receipt: null,
        receiptError: null,
        errors: {},
        summary: null,
      };
    }
    case "startAnother":
      return { ...state, step: 1, direction: "back", result: null };
    default:
      return state;
  }
}

// ---------------------------------------------------------------- selectors

export function selectExpected(state: PayState, options: readonly CollectionOption[]): ExpectedTotal {
  return expectedTotal(state.students, options);
}

/** Amount shown in the field: what the person typed, else the expected total ("28,00") once known. */
export function selectAmountValue(state: PayState, expected: ExpectedTotal): string {
  if (state.fields.amountTouched) return state.fields.amount;
  return expected.complete && expected.total > 0 ? plainAmount(expected.total).replace(".", ",") : "";
}

export interface AmountStatus {
  value: string;
  cents: number | null;
  /** Typed amount differs from the expected total (allowed, flagged for review). */
  mismatch: boolean;
  expected: ExpectedTotal;
}

export function selectAmount(state: PayState, options: readonly CollectionOption[]): AmountStatus {
  const expected = selectExpected(state, options);
  const value = selectAmountValue(state, expected);
  const cents = parseAmountCents(value);
  return { value, cents, expected, mismatch: expected.complete && cents !== null && cents !== expected.total };
}

export function submitLabel(amount: AmountStatus): string {
  const { expected, cents } = amount;
  return expected.complete && expected.total > 0 ? `Registrar pago · ${formatMoney(cents ?? expected.total)}` : "Registrar pago";
}

export function toPaymentValues(state: PayState, amount: string): PaymentValues {
  return {
    students: state.students,
    hasReceipt: state.receipt?.status === "ready",
    amount,
    transferDate: state.fields.transferDate,
    bank: state.fields.bank,
    reference: state.fields.reference,
    parentName: state.fields.parentName,
    phone: state.fields.phone,
    consent: state.fields.consent,
  };
}

/** "Mateo Andrade" from "Mateo José" + "Andrade Vásquez" (success screen). */
export function shortStudentName(student: StudentValues): string {
  const first = student.givenNames.trim().split(/\s+/)[0] ?? "";
  const surname = student.surnames.trim().split(/\s+/)[0] ?? "";
  return `${first} ${surname}`.trim();
}

export function studentOptionLabel(student: StudentValues, options: readonly CollectionOption[]): string | null {
  return options.length > 1 && student.option !== null ? optionLabel(options, student.option) : null;
}
