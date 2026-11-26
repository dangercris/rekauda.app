import { COLLECTION_STATUSES, type CollectionOption, type CollectionStatus } from "../shared/api";
import { CODE_ALPHABET } from "./ids";
import { EARLIEST_TRANSFER, EARLIEST_TRANSFER_LABEL } from "./constants";
import { HttpError } from "./http";

/** Pure parsers and text helpers. They throw HttpError with Spanish messages safe to show to families. */

export type StudentInput = { givenNames: string; surnames: string; option: CollectionOption };

export type CollectionFields = {
  slug: string;
  title: string;
  eyebrow: string | null;
  description: string;
  notes: string[];
  options: CollectionOption[];
  deadline: string;
  status: CollectionStatus;
  maxPerPayment: number;
  tone: string;
  deunaLink: string | null;
  deunaLinkExpires: string | null;
};

export type FileKind = { type: string; ext: string };

// ---------------------------------------------------------------- text helpers

export function text(value: File | string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function cleanText(raw: string, max: number): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function displayName(givenNames: string, surnames: string): string {
  const first = givenNames.split(" ")[0] ?? "";
  const initial = (surnames.trim()[0] ?? "").toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

export function normalizeCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 6 || [...compact].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

// ---------------------------------------------------------------- payment fields

export function personName(raw: string, label: string): string {
  const value = cleanText(raw, 60).replace(/[’‘]/g, "'");
  if (value.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(value)) {
    throw new HttpError(400, "invalid_name", `Revisa ${label}: solo letras, entre 2 y 60 caracteres.`);
  }
  return value;
}

export function parsePhone(raw: string): string {
  const digits = raw.replace(/[\s().-]/g, "");
  const ec = digits.match(/^(?:\+?5930?|0)?(9\d{8})$/);
  if (ec?.[1]) return `+593${ec[1]}`;
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  throw new HttpError(400, "invalid_phone", "Escribe un celular válido, por ejemplo 0991234567.");
}

/** Dates are Ecuador calendar days (UTC-5); `now` is injectable for tests. */
export function parseTransferDate(raw: string, now: number = Date.now()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new HttpError(400, "invalid_date", "Escribe la fecha de la transferencia.");
  }
  const tomorrowEc = new Date(now - 5 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
  if (raw < EARLIEST_TRANSFER || raw > tomorrowEc) {
    throw new HttpError(400, "invalid_date", `La fecha de la transferencia no puede ser futura ni anterior a ${EARLIEST_TRANSFER_LABEL}.`);
  }
  return raw;
}

export function parseAmount(raw: string): number {
  const normalized = raw.replace(/\s|\$/g, "").replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(normalized)) throw new HttpError(400, "invalid_amount", "Escribe el monto transferido, por ejemplo 14,00.");
  const cents = Math.round(Number(normalized) * 100);
  if (cents < 100 || cents > 600_000) throw new HttpError(400, "invalid_amount", "El monto transferido no parece correcto.");
  return cents;
}

export function parseReference(raw: string): string | null {
  const value = cleanText(raw, 40);
  if (!value) return null;
  if (!/^[\p{L}\p{N} ./#-]+$/u.test(value)) throw new HttpError(400, "invalid_reference", "El número de comprobante solo puede tener letras y números.");
  return value;
}

export function parseStudents(raw: string, options: CollectionOption[], maxPerPayment: number): StudentInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_students", "Agrega al menos un estudiante.");
  }
  if (!Array.isArray(parsed) || parsed.length < 1) throw new HttpError(400, "invalid_students", "Agrega al menos un estudiante.");
  if (parsed.length > maxPerPayment) {
    throw new HttpError(400, "too_many_students", `Puedes registrar hasta ${maxPerPayment} estudiantes por comprobante.`);
  }

  const seen = new Set<string>();
  return parsed.map((item: unknown, index) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const label = parsed.length > 1 ? ` del estudiante ${index + 1}` : " del estudiante";
    const givenNames = personName(typeof entry.givenNames === "string" ? entry.givenNames : "", `los nombres${label}`);
    const surnames = personName(typeof entry.surnames === "string" ? entry.surnames : "", `los apellidos${label}`);
    const option = typeof entry.option === "string" ? options.find((o) => o.key === entry.option) : undefined;
    if (!option) throw new HttpError(400, "invalid_option", `Elige una opción del estudiante ${index + 1}.`);
    const key = normalize(`${givenNames} ${surnames}`);
    if (seen.has(key)) throw new HttpError(400, "repeated_student", "Hay un estudiante repetido en el registro.");
    seen.add(key);
    return { givenNames, surnames, option };
  });
}

// ---------------------------------------------------------------- collection fields

/** Trims and collapses whitespace, then rejects (never truncates) text outside the allowed length. */
export function boundedText(value: unknown, min: number, max: number, message: string): string {
  const cleaned = typeof value === "string" ? cleanText(value, max + 1) : "";
  if (cleaned.length < min || cleaned.length > max) throw new HttpError(400, "invalid_collection", message);
  return cleaned;
}

/** `#RRGGBB` (any case) in, uppercase out. */
export function parseTone(raw: unknown): string {
  if (typeof raw !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
    throw new HttpError(400, "invalid_collection", "El color debe tener el formato #RRGGBB, por ejemplo #C81E3A.");
  }
  return raw.trim().toUpperCase();
}

export function parseCollectionOptions(raw: unknown): CollectionOption[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 6) {
    throw new HttpError(400, "invalid_collection", "Agrega entre 1 y 6 opciones.");
  }
  const keys = new Set<string>();
  return raw.map((item: unknown, index) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const n = index + 1;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (!/^[a-z0-9-]{1,24}$/.test(key)) {
      throw new HttpError(400, "invalid_collection", `Opción ${n}: el código admite minúsculas, números y guiones (hasta 24).`);
    }
    if (keys.has(key)) throw new HttpError(400, "invalid_collection", `Opción ${n}: el código "${key}" está repetido.`);
    keys.add(key);
    const label = boundedText(entry.label, 2, 60, `Opción ${n}: el nombre debe tener entre 2 y 60 caracteres.`);
    const detail =
      entry.detail === undefined || entry.detail === null || entry.detail === ""
        ? null
        : boundedText(entry.detail, 1, 60, `Opción ${n}: el detalle puede tener hasta 60 caracteres.`);
    const cents = entry.cents;
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 100 || cents > 100_000) {
      throw new HttpError(400, "invalid_collection", `Opción ${n}: el precio va de USD 1,00 a USD 1000,00.`);
    }
    return { key, label, detail, cents };
  });
}

export function parseCollectionFields(body: Record<string, unknown>, creating: boolean): Partial<CollectionFields> {
  const out: Partial<CollectionFields> = {};
  const given = (key: string) => creating || body[key] !== undefined;

  if (given("slug")) {
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (slug.length < 3 || slug.length > 48 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      throw new HttpError(400, "invalid_collection", "El enlace debe tener entre 3 y 48 caracteres: minúsculas, números y guiones.");
    }
    out.slug = slug;
  }
  if (given("title")) out.title = boundedText(body.title, 3, 80, "El título debe tener entre 3 y 80 caracteres.");
  if (body.eyebrow !== undefined) {
    out.eyebrow = body.eyebrow === null || body.eyebrow === "" ? null : boundedText(body.eyebrow, 1, 40, "La etiqueta puede tener hasta 40 caracteres.");
  }
  if (given("description")) out.description = boundedText(body.description, 10, 400, "La descripción debe tener entre 10 y 400 caracteres.");
  if (body.notes !== undefined) {
    if (!Array.isArray(body.notes) || body.notes.length > 6) throw new HttpError(400, "invalid_collection", "Puedes agregar hasta 6 notas.");
    out.notes = (body.notes as unknown[])
      .map((n) => (typeof n === "string" ? cleanText(n, 201) : ""))
      .filter((n) => n.length > 0)
      .map((n) => {
        if (n.length > 200) throw new HttpError(400, "invalid_collection", "Cada nota puede tener hasta 200 caracteres.");
        return n;
      });
  }
  if (given("options")) out.options = parseCollectionOptions(body.options);
  if (given("deadline")) {
    const deadline = typeof body.deadline === "string" ? body.deadline : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(`${deadline}T00:00:00Z`))) {
      throw new HttpError(400, "invalid_collection", "Escribe una fecha límite válida.");
    }
    out.deadline = deadline;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !(COLLECTION_STATUSES as readonly string[]).includes(body.status)) {
      throw new HttpError(400, "invalid_collection", "Estado no válido.");
    }
    out.status = body.status as CollectionStatus;
  }
  if (body.maxPerPayment !== undefined) {
    const max = body.maxPerPayment;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 6) {
      throw new HttpError(400, "invalid_collection", "El máximo por comprobante va de 1 a 6.");
    }
    out.maxPerPayment = max;
  }
  if (body.tone !== undefined) out.tone = parseTone(body.tone);
  if (body.deunaLink !== undefined) {
    out.deunaLink = parseDeunaLink(body.deunaLink);
    // The expiry only makes sense next to a link.
    if (out.deunaLink === null) out.deunaLinkExpires = null;
  }
  if (body.deunaLinkExpires !== undefined && out.deunaLinkExpires === undefined) {
    out.deunaLinkExpires = parseDeunaLinkExpires(body.deunaLinkExpires);
  }
  return out;
}

export const DEUNA_LINK_PREFIX = "https://pagar.deuna.app/";
export const MAX_DEUNA_LINK_LENGTH = 1000;

/** Deuna charge link: stored exactly as pasted (it carries + / = and must not be re-encoded). */
export function parseDeunaLink(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") throw new HttpError(400, "invalid_collection", "El link de cobro de Deuna no es válido.");
  const value = raw.trim();
  if (!value) return null;
  if (value.length > MAX_DEUNA_LINK_LENGTH) {
    throw new HttpError(400, "invalid_collection", `El link de cobro de Deuna puede tener hasta ${MAX_DEUNA_LINK_LENGTH} caracteres.`);
  }
  if (/\s/.test(value)) throw new HttpError(400, "invalid_collection", "El link de cobro de Deuna no debe tener espacios.");
  if (!value.startsWith(DEUNA_LINK_PREFIX) || value.length === DEUNA_LINK_PREFIX.length) {
    throw new HttpError(400, "invalid_collection", `El link de cobro de Deuna debe empezar con ${DEUNA_LINK_PREFIX}`);
  }
  return value;
}

/** YYYY-MM-DD that exists on the calendar, or null when empty. */
export function parseDeunaLinkExpires(raw: unknown): string | null {
  if (raw === null || raw === "") return null;
  const invalid = () => new HttpError(400, "invalid_collection", "Escribe una fecha de vencimiento válida para el link de Deuna.");
  if (typeof raw !== "string") throw invalid();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw invalid();
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) throw invalid();
  return raw;
}

// ---------------------------------------------------------------- file sniffing (magic bytes only)

function ascii(b: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...b.subarray(start, end));
}

/** Cover images: JPEG, PNG or WEBP. */
export function sniffImage(b: Uint8Array): FileKind | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

/** Receipts: the images above plus PDF. */
export function sniffReceipt(b: Uint8Array): FileKind | null {
  const image = sniffImage(b);
  if (image) return image;
  if (b.length >= 12 && ascii(b, 0, 5) === "%PDF-") return { type: "application/pdf", ext: "pdf" };
  return null;
}

export function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}
