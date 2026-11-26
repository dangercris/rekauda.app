/**
 * Formatting helpers for Spanish (Ecuador). Deterministic on purpose (no Intl locale data), so output
 * is identical on every phone and in tests. Money is integer cents; Ecuador uses USD with "." for
 * thousands and "," for decimals ("$1.696,00"). Ecuador has no DST: local time is always UTC-5.
 */

// ---------------------------------------------------------------- numbers and money

export function formatInt(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export interface MoneyParts {
  negative: boolean;
  symbol: "$";
  /** Integer part with thousands separators, e.g. "1.696". */
  int: string;
  /** Two-digit cents, e.g. "00". */
  cents: string;
}

export function moneyParts(cents: number): MoneyParts {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(safe);
  return {
    negative: safe < 0,
    symbol: "$",
    int: formatInt(Math.floor(abs / 100)),
    cents: String(abs % 100).padStart(2, "0"),
  };
}

export interface FormatMoneyOptions {
  /** Drop ",00" when the amount is whole (compact rows like "$315 de $480"). */
  compact?: boolean | undefined;
}

/** "$1.696,00" (or "$1.696" with `compact` when there are no cents). */
export function formatMoney(cents: number, options: FormatMoneyOptions = {}): string {
  const p = moneyParts(cents);
  const tail = options.compact && p.cents === "00" ? "" : `,${p.cents}`;
  return `${p.negative ? "-" : ""}${p.symbol}${p.int}${tail}`;
}

/** Plain decimal string for forms and the API: 2800 -> "28.00". */
export function plainAmount(cents: number): string {
  const p = moneyParts(cents);
  return `${p.negative ? "-" : ""}${p.int.replace(/\./g, "")}.${p.cents}`;
}

/**
 * Parses what a person types as an amount into cents. Accepts "14", "14,00", "14.5", "$14", "USD 14.00",
 * "1.696,00", "1,696.00", "1.696". Returns null for empty, negative, malformed or >2 decimal inputs.
 * A single separator followed by exactly three digits is read as thousands ("1.696" -> 169600).
 */
export function parseAmountCents(input: string): number | null {
  const cleaned = input.trim().replace(/^usd\s*/i, "").replace(/^\$\s*/, "").replace(/\s+/g, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let intPart: string;
  let decPart = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const decIndex = Math.max(lastDot, lastComma);
    const thousandsSep = decIndex === lastDot ? "," : ".";
    intPart = cleaned.slice(0, decIndex);
    decPart = cleaned.slice(decIndex + 1);
    if (intPart.includes(cleaned[decIndex] ?? "")) return null;
    if (!isGrouped(intPart, thousandsSep)) return null;
    intPart = intPart.split(thousandsSep).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const pieces = cleaned.split(sep);
    const tail = pieces[pieces.length - 1] ?? "";
    if (pieces.length === 2 && tail.length !== 3) {
      intPart = pieces[0] ?? "";
      decPart = tail;
    } else if (isGrouped(cleaned, sep)) {
      intPart = pieces.join("");
    } else {
      return null;
    }
  } else {
    intPart = cleaned;
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

function isGrouped(value: string, sep: string): boolean {
  const groups = value.split(sep);
  if (groups.length === 1) return /^\d+$/.test(value);
  const [first, ...rest] = groups;
  return /^\d{1,3}$/.test(first ?? "") && rest.every((g) => /^\d{3}$/.test(g));
}

export function plural(n: number, one: string, many: string, withCount = true): string {
  const word = n === 1 ? one : many;
  return withCount ? `${formatInt(n)} ${word}` : word;
}

/** "248 KB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatInt(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatInt(Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} MB`;
}

// ---------------------------------------------------------------- text

/** Up to two initials from a person's name: "Mateo Andrade" -> "MA", "ana" -> "A". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]?.[0] ?? "" : "";
  return (first + last).toLocaleUpperCase("es");
}

/** Lowercase, no diacritics, single spaces: for client-side search. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- dates (Ecuador, UTC-5)

const EC_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
export const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
export const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;
export const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

export interface EcDateParts {
  year: number;
  /** 1..12 */
  month: number;
  day: number;
  /** 0 = domingo */
  weekday: number;
  hour: number;
  minute: number;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Parses an API timestamp into a Date. ISO strings with a zone are used as is; zone-less
 * "YYYY-MM-DD HH:MM:SS" (SQLite) is treated as UTC. Returns null when unparseable.
 */
export function parseInstant(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = value.trim();
  const iso = NAIVE_DATETIME_RE.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar parts of an instant as seen in Ecuador. */
export function ecParts(instant: Date): EcDateParts {
  const shifted = new Date(instant.getTime() + EC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Today's date in Ecuador as YYYY-MM-DD. */
export function todayEc(now: Date = new Date()): string {
  const p = ecParts(now);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Calendar parts of a date-only value ("2026-12-02") or an instant (converted to Ecuador). */
function calendarParts(value: string | Date): EcDateParts | null {
  if (typeof value === "string") {
    const m = YMD_RE.exec(value.trim());
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const utc = new Date(Date.UTC(year, month - 1, day));
      if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
      return { year, month, day, weekday: utc.getUTCDay(), hour: 0, minute: 0 };
    }
  }
  const instant = parseInstant(value);
  return instant ? ecParts(instant) : null;
}

/** Whole days from today (Ecuador) until `date`: 0 today, 1 tomorrow, negative when past. NaN if invalid. */
export function daysUntil(date: string, now: Date = new Date()): number {
  const target = calendarParts(date);
  const today = calendarParts(todayEc(now));
  if (!target || !today) return Number.NaN;
  const a = Date.UTC(target.year, target.month - 1, target.day);
  const b = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((a - b) / DAY_MS);
}

/** "miércoles 2 de diciembre" (or "... de 2026" with `withYear`). */
export function longDate(value: string | Date, withYear = false): string {
  const p = calendarParts(value);
  if (!p) return "";
  const base = `${WEEKDAYS[p.weekday]} ${p.day} de ${MONTHS[p.month - 1]}`;
  return withYear ? `${base} de ${p.year}` : base;
}

/** "mié 2 dic". */
export function shortDate(value: string | Date): string {
  const p = calendarParts(value);
  return p ? `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}` : "";
}

/** "2 dic 2026". */
export function compactDate(value: string | Date): string {
  const p = calendarParts(value);
  return p ? `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}` : "";
}

/** "10:38" in Ecuador time. */
export function timeOfDay(value: string | Date): string {
  const instant = parseInstant(value);
  if (!instant) return "";
  const p = ecParts(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "26 nov 2026 · 10:38". */
export function dateTime(value: string | Date): string {
  const instant = parseInstant(value);
  if (!instant) return "";
  return `${compactDate(instant)} · ${timeOfDay(instant)}`;
}

/** "Hoy · 10:42", "Ayer · 08:10", "26 nov · 10:42", or with year when not this year. */
export function relative(value: string | Date, now: Date = new Date()): string {
  const instant = parseInstant(value);
  if (!instant) return "";
  const days = daysUntil(todayEc(instant), now);
  const time = timeOfDay(instant);
  if (days === 0) return `Hoy · ${time}`;
  if (days === -1) return `Ayer · ${time}`;
  const p = ecParts(instant);
  const sameYear = p.year === ecParts(now).year;
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}${sameYear ? "" : ` ${p.year}`} · ${time}`;
}

/** "hace un momento", "hace 23 min", "hace 3 h", "ayer", "hace 4 días", then "26 nov". */
export function timeAgo(value: string | Date, now: Date = new Date()): string {
  const instant = parseInstant(value);
  if (!instant) return "";
  const diff = now.getTime() - instant.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && daysUntil(todayEc(instant), now) === 0) return `hace ${hours} h`;
  const days = -daysUntil(todayEc(instant), now);
  if (days <= 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  const p = ecParts(instant);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** Countdown copy for a deadline: "Faltan 16 días", "Falta 1 día", "Último día", "Plazo vencido". */
export function daysLeftLabel(days: number): string {
  if (Number.isNaN(days)) return "";
  if (days < 0) return "Plazo vencido";
  if (days === 0) return "Último día";
  return days === 1 ? "Falta 1 día" : `Faltan ${formatInt(days)} días`;
}
