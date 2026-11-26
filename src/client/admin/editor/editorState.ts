/**
 * Collection ("evento") editor state: a reducer over a form draft, client validation that mirrors the
 * Worker (src/worker/validation.ts), mapping of server errors to fields, and the request body.
 * Pure module: the component only dispatches and renders.
 */
import { DEFAULT_TONE } from "../../../shared/instance-bundled";
import type { AdminCollection, AdminCollectionInput, CollectionOption, CollectionStatus } from "../../../shared/api";
import { normalizeHex } from "../../design";
import { isApiRequestError } from "../../lib/api";
import { parseAmountCents, plainAmount } from "../../lib/format";

export const MAX_OPTIONS = 6;
export const MAX_NOTES = 6;
export const MAX_NOTE_LENGTH = 200;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const OPTION_KEY_RE = /^[a-z0-9-]{1,24}$/;
export const TONE_PRESETS = [
  { value: "#C81E3A", name: "Carmesí", role: "Navidad" },
  { value: "#3D4FA3", name: "Índigo", role: "Paseos" },
  { value: "#0B7A73", name: "Pino", role: "Materiales" },
] as const;
export const DEFAULT_MAX_PER_PAYMENT = 4;
export const DEUNA_LINK_PREFIX = "https://pagar.deuna.app/";
export const MAX_DEUNA_LINK_LENGTH = 1000;

export interface OptionDraft {
  /** Local identity for React keys and error mapping. */
  uid: string;
  key: string;
  /** The key was typed by hand: stop deriving it from the label. */
  keyTouched: boolean;
  /** Existing keys identify registered students: read-only. */
  locked: boolean;
  label: string;
  detail: string;
  /** As typed: "14", "14,00", "14.5". */
  price: string;
}

export interface EditorDraft {
  title: string;
  slug: string;
  slugTouched: boolean;
  eyebrow: string;
  description: string;
  /** One note per line. */
  notes: string;
  options: OptionDraft[];
  /** YYYY-MM-DD */
  deadline: string;
  maxPerPayment: number;
  status: CollectionStatus;
  tone: string;
  /** Deuna charge link, as pasted. */
  deunaLink: string;
  /** YYYY-MM-DD, optional. */
  deunaLinkExpires: string;
}

export type CoverChange = { kind: "keep" } | { kind: "replace"; file: File } | { kind: "remove" };

export type FieldKey =
  | "title"
  | "slug"
  | "eyebrow"
  | "description"
  | "notes"
  | "options"
  | "deadline"
  | "maxPerPayment"
  | "tone"
  | "deunaLink"
  | "deunaLinkExpires"
  | `option:${string}:${"label" | "detail" | "price" | "key"}`;

export type FieldErrors = Partial<Record<FieldKey, string>>;

export interface EditorState {
  draft: EditorDraft;
  /** Serialized draft at load or last save: the unsaved-changes baseline. */
  baseline: string;
  cover: CoverChange;
  errors: FieldErrors;
  /** Message for errors that do not belong to one field. */
  formError: string | null;
  /** The person tried to save once: show every error from now on. */
  submitted: boolean;
}

let uidCounter = 0;
const nextUid = (): string => {
  uidCounter += 1;
  return `opt${uidCounter}`;
};

/** "Paseo al Cotopaxi 2026" -> "paseo-al-cotopaxi-2026" (max 48, no dangling dash). */
export function slugify(value: string, max = 48): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/** Option key derived from its label: same rules as the slug, up to 24 characters. */
export const keyFromLabel = (label: string): string => slugify(label, 24);

export function priceInput(cents: number): string {
  return plainAmount(cents).replace(".", ",");
}

export function emptyOption(): OptionDraft {
  return { uid: nextUid(), key: "", keyTouched: false, locked: false, label: "", detail: "", price: "" };
}

export function newDraft(): EditorDraft {
  return {
    title: "",
    slug: "",
    slugTouched: false,
    eyebrow: "",
    description: "",
    notes: "",
    options: [emptyOption()],
    deadline: "",
    maxPerPayment: DEFAULT_MAX_PER_PAYMENT,
    status: "abierta",
    tone: DEFAULT_TONE,
    deunaLink: "",
    deunaLinkExpires: "",
  };
}

export function draftFromCollection(c: AdminCollection): EditorDraft {
  return {
    title: c.title,
    slug: c.slug,
    slugTouched: true,
    eyebrow: c.eyebrow ?? "",
    description: c.description,
    notes: c.notes.join("\n"),
    options: c.options.map((o) => ({
      uid: nextUid(),
      key: o.key,
      keyTouched: true,
      locked: true,
      label: o.label,
      detail: o.detail ?? "",
      price: priceInput(o.cents),
    })),
    deadline: c.deadline,
    maxPerPayment: c.maxPerPayment,
    status: c.status,
    tone: normalizeHex(c.tone) ?? DEFAULT_TONE,
    deunaLink: c.deunaLink ?? "",
    deunaLinkExpires: c.deunaLinkExpires ?? "",
  };
}

/** Comparable form of a draft (ignores local uids and "touched" flags). */
export function serializeDraft(d: EditorDraft): string {
  return JSON.stringify({
    title: d.title.trim(),
    slug: d.slug.trim(),
    eyebrow: d.eyebrow.trim(),
    description: d.description.trim(),
    notes: splitNotes(d.notes),
    options: d.options.map((o) => [o.key.trim(), o.label.trim(), o.detail.trim(), o.price.trim()]),
    deadline: d.deadline,
    maxPerPayment: d.maxPerPayment,
    status: d.status,
    tone: normalizeHex(d.tone),
    deunaLink: d.deunaLink.trim(),
    deunaLinkExpires: d.deunaLinkExpires,
  });
}

export function initEditor(collection: AdminCollection | null): EditorState {
  const draft = collection ? draftFromCollection(collection) : newDraft();
  return { draft, baseline: serializeDraft(draft), cover: { kind: "keep" }, errors: {}, formError: null, submitted: false };
}

export function isDirty(state: EditorState): boolean {
  return state.cover.kind !== "keep" || serializeDraft(state.draft) !== state.baseline;
}

// ---------------------------------------------------------------- reducer

type TextField = "title" | "slug" | "eyebrow" | "description" | "notes" | "deadline" | "deunaLink" | "deunaLinkExpires";
type OptionField = "label" | "detail" | "price" | "key";

export type EditorAction =
  | { type: "field"; field: TextField; value: string }
  | { type: "maxPerPayment"; value: number }
  | { type: "status"; value: CollectionStatus }
  | { type: "tone"; value: string }
  | { type: "addOption" }
  | { type: "removeOption"; uid: string }
  | { type: "option"; uid: string; field: OptionField; value: string }
  | { type: "cover"; change: CoverChange }
  | { type: "submitted"; errors: FieldErrors }
  | { type: "serverError"; errors: FieldErrors; formError: string | null }
  | { type: "reset"; collection: AdminCollection | null };

function withField(state: EditorState, draft: EditorDraft, touched: FieldKey[]): EditorState {
  const next = { ...state, draft };
  // Live re-validation only after a first save attempt, so people are not scolded while typing.
  if (!state.submitted) {
    const errors = { ...state.errors };
    for (const key of touched) delete errors[key];
    return { ...next, errors };
  }
  return { ...next, errors: validateDraft(draft) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const d = state.draft;
  switch (action.type) {
    case "field": {
      if (action.field === "title") {
        const slug = d.slugTouched ? d.slug : slugify(action.value);
        return withField(state, { ...d, title: action.value, slug }, ["title", "slug"]);
      }
      if (action.field === "slug") {
        const value = action.value.toLowerCase().replace(/\s+/g, "-");
        return withField(state, { ...d, slug: value, slugTouched: value.length > 0 }, ["slug"]);
      }
      return withField(state, { ...d, [action.field]: action.value }, [action.field]);
    }
    case "maxPerPayment":
      return withField(state, { ...d, maxPerPayment: action.value }, ["maxPerPayment"]);
    case "status":
      return withField(state, { ...d, status: action.value }, []);
    case "tone": {
      const tone = normalizeHex(action.value);
      return tone ? withField(state, { ...d, tone }, ["tone"]) : state;
    }
    case "addOption":
      if (d.options.length >= MAX_OPTIONS) return state;
      return withField(state, { ...d, options: [...d.options, emptyOption()] }, ["options"]);
    case "removeOption":
      if (d.options.length <= 1) return state;
      return withField(state, { ...d, options: d.options.filter((o) => o.uid !== action.uid) }, ["options"]);
    case "option": {
      const options = d.options.map((o) => {
        if (o.uid !== action.uid) return o;
        if (action.field === "key") {
          if (o.locked) return o;
          return { ...o, key: action.value.toLowerCase().replace(/\s+/g, "-"), keyTouched: action.value.length > 0 };
        }
        if (action.field === "label") {
          const key = o.locked || o.keyTouched ? o.key : keyFromLabel(action.value);
          return { ...o, label: action.value, key };
        }
        return { ...o, [action.field]: action.value };
      });
      const prefix = `option:${action.uid}:` as const;
      return withField(state, { ...d, options }, [`${prefix}${action.field}`, `${prefix}key`, "options"]);
    }
    case "cover":
      return { ...state, cover: action.change };
    case "submitted":
      return { ...state, submitted: true, errors: action.errors, formError: null };
    case "serverError":
      return { ...state, errors: { ...state.errors, ...action.errors }, formError: action.formError };
    case "reset":
      return initEditor(action.collection);
  }
}

// ---------------------------------------------------------------- validation

export function splitNotes(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((n) => n.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
}

/** Price typed by a person ("14", "14,00", "14.5", "$ 14") in cents, or null. */
export function parsePrice(value: string): number | null {
  return parseAmountCents(value);
}

export function validateDraft(d: EditorDraft): FieldErrors {
  const errors: FieldErrors = {};
  const title = clean(d.title);
  if (title.length < 3 || title.length > 80) errors.title = "Escribe un título de 3 a 80 caracteres.";

  const slug = d.slug.trim();
  if (!slug) errors.slug = "Escribe el enlace, por ejemplo paseo-cotopaxi.";
  else if (slug.length < 3 || slug.length > 48 || !SLUG_RE.test(slug)) {
    errors.slug = "Usa de 3 a 48 caracteres: minúsculas, números y guiones entre palabras.";
  }

  if (clean(d.eyebrow).length > 40) errors.eyebrow = "La etiqueta puede tener hasta 40 caracteres.";

  const description = clean(d.description);
  if (description.length < 10 || description.length > 400) errors.description = "Escribe una descripción de 10 a 400 caracteres.";

  const notes = splitNotes(d.notes);
  if (notes.length > MAX_NOTES) errors.notes = `Puedes agregar hasta ${MAX_NOTES} notas (tienes ${notes.length}).`;
  else if (notes.some((n) => n.length > MAX_NOTE_LENGTH)) errors.notes = `Cada nota puede tener hasta ${MAX_NOTE_LENGTH} caracteres.`;

  if (d.options.length < 1 || d.options.length > MAX_OPTIONS) errors.options = `Agrega entre 1 y ${MAX_OPTIONS} opciones.`;
  const seen = new Map<string, string>();
  for (const o of d.options) {
    const label = clean(o.label);
    if (label.length < 2 || label.length > 60) errors[`option:${o.uid}:label`] = "Escribe un nombre de 2 a 60 caracteres.";
    if (clean(o.detail).length > 60) errors[`option:${o.uid}:detail`] = "El detalle puede tener hasta 60 caracteres.";
    const cents = parsePrice(o.price);
    if (cents === null) errors[`option:${o.uid}:price`] = "Escribe el precio, por ejemplo 14,00.";
    else if (cents < 100 || cents > 100_000) errors[`option:${o.uid}:price`] = "El precio va de $1,00 a $1.000,00.";
    const key = o.key.trim();
    if (!OPTION_KEY_RE.test(key)) {
      errors[`option:${o.uid}:key`] = "El código admite minúsculas, números y guiones (hasta 24).";
    } else if (seen.has(key)) {
      errors[`option:${o.uid}:key`] = `El código "${key}" ya lo usa otra opción.`;
    } else {
      seen.set(key, o.uid);
    }
  }

  if (!d.deadline) errors.deadline = "Elige la fecha límite.";
  else if (!isValidDate(d.deadline)) errors.deadline = "Escribe una fecha límite válida.";

  if (!Number.isInteger(d.maxPerPayment) || d.maxPerPayment < 1 || d.maxPerPayment > 6) {
    errors.maxPerPayment = "Elige de 1 a 6 estudiantes por comprobante.";
  }
  if (!normalizeHex(d.tone)) errors.tone = "Elige un color.";

  const deunaLink = d.deunaLink.trim();
  if (deunaLink) {
    if (deunaLink.length > MAX_DEUNA_LINK_LENGTH) errors.deunaLink = `El link puede tener hasta ${MAX_DEUNA_LINK_LENGTH} caracteres.`;
    else if (/\s/.test(deunaLink)) errors.deunaLink = "El link no debe tener espacios.";
    else if (!deunaLink.startsWith(DEUNA_LINK_PREFIX) || deunaLink.length === DEUNA_LINK_PREFIX.length) {
      errors.deunaLink = `El link debe empezar con ${DEUNA_LINK_PREFIX}`;
    }
    if (d.deunaLinkExpires && !isValidDate(d.deunaLinkExpires)) errors.deunaLinkExpires = "Escribe una fecha de vencimiento válida.";
  }
  return errors;
}

/** Field order used to focus the first error. */
export function firstErrorKey(errors: FieldErrors, d: EditorDraft): FieldKey | null {
  const order: FieldKey[] = ["title", "slug", "eyebrow", "description", "notes", "tone", "options"];
  for (const o of d.options) order.push(`option:${o.uid}:label`, `option:${o.uid}:detail`, `option:${o.uid}:price`, `option:${o.uid}:key`);
  order.push("deadline", "maxPerPayment", "deunaLink", "deunaLinkExpires");
  return order.find((key) => errors[key] !== undefined) ?? null;
}

/** Request body (assumes `validateDraft` returned no errors). */
export function toInput(d: EditorDraft): AdminCollectionInput {
  const deunaLink = d.deunaLink.trim();
  const options: CollectionOption[] = d.options.map((o) => ({
    key: o.key.trim(),
    label: clean(o.label),
    detail: clean(o.detail) || null,
    cents: parsePrice(o.price) ?? 0,
  }));
  return {
    title: clean(d.title),
    slug: d.slug.trim(),
    eyebrow: clean(d.eyebrow) || null,
    description: clean(d.description),
    notes: splitNotes(d.notes),
    options,
    deadline: d.deadline,
    maxPerPayment: d.maxPerPayment,
    status: d.status,
    tone: normalizeHex(d.tone) ?? DEFAULT_TONE,
    deunaLink: deunaLink || null,
    deunaLinkExpires: deunaLink ? d.deunaLinkExpires || null : null,
  };
}

/**
 * Places a server rejection next to the field it is about. The Worker answers 400 `invalid_collection`
 * with a Spanish message, 409 `slug_taken` and 409 `option_in_use`.
 */
export function mapServerError(error: unknown, d: EditorDraft): { errors: FieldErrors; formError: string | null } {
  if (!isApiRequestError(error)) return { errors: {}, formError: "No se pudo guardar. Intenta de nuevo." };
  const message = error.message;
  if (error.code === "slug_taken") return { errors: { slug: message }, formError: null };
  if (error.code === "option_in_use") return { errors: { options: message }, formError: null };
  if (error.code !== "invalid_collection") return { errors: {}, formError: message };

  const option = /^Opción (\d+):/.exec(message);
  if (option) {
    const target = d.options[Number(option[1]) - 1];
    const text = message.replace(/^Opción \d+:\s*/, "");
    const capitalized = text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
    if (target) {
      const field = /código/i.test(text) ? "key" : /precio/i.test(text) ? "price" : /detalle/i.test(text) ? "detail" : "label";
      return { errors: { [`option:${target.uid}:${field}`]: capitalized }, formError: null };
    }
    return { errors: { options: message }, formError: null };
  }
  const rules: Array<[RegExp, FieldKey]> = [
    [/vencimiento/i, "deunaLinkExpires"],
    [/link de cobro/i, "deunaLink"],
    [/enlace/i, "slug"],
    [/título/i, "title"],
    [/etiqueta/i, "eyebrow"],
    [/descripción/i, "description"],
    [/nota/i, "notes"],
    [/opciones/i, "options"],
    [/fecha/i, "deadline"],
    [/máximo/i, "maxPerPayment"],
    [/color/i, "tone"],
  ];
  const hit = rules.find(([re]) => re.test(message));
  return hit ? { errors: { [hit[1]]: message }, formError: null } : { errors: {}, formError: message };
}
