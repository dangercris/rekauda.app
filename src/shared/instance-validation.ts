import type { InstanceConfig } from "./instance-config";

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Longest accepted text value: these strings end up in every page, card and boot payload of a tenant. */
const MAX_TEXT = 200;

/** Control characters and bidi overrides/isolates: they can hide or reorder text in pages, cards and mail. */
const UNSAFE_CHARS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const MAX_URL = 2048;
const MAX_ACCOUNT = 32;

/** Pure and dependency free: it runs when the config module loads, in the Worker, the client bundle and tests. */
export function validateInstanceConfig(config: InstanceConfig, source = "rekauda.config.ts"): InstanceConfig {
  const fail = (field: string, rule: string): never => {
    throw new Error(`Invalid ${source}: ${field} ${rule}.`);
  };
  const text = (field: string, value: unknown): void => {
    if (typeof value !== "string" || value.trim() === "") fail(field, "must be a non-empty string");
    if ((value as string).length > MAX_TEXT) fail(field, `must be at most ${MAX_TEXT} characters`);
    if (UNSAFE_CHARS.test(value as string)) fail(field, "must not contain control or bidirectional characters");
  };
  const url = (field: string, value: string | null): void => {
    if (value !== null && value.length > MAX_URL) fail(field, `must be at most ${MAX_URL} characters`);
    if (value !== null && UNSAFE_CHARS.test(value)) fail(field, "must not contain control or bidirectional characters");
  };

  text("schoolName", config.schoolName);
  text("className", config.className);
  text("classShortName", config.classShortName);
  text("classMark", config.classMark);
  if (config.classMark.length > 3) fail("classMark", "must be at most 3 characters");

  const t = config.treasury;
  text("treasury.bank", t.bank);
  text("treasury.accountType", t.accountType);
  text("treasury.holder", t.holder);
  text("treasury.holderId", t.holderId);
  // The Deuna email pipeline matches the destination account by its last 4 digits.
  if (!/^\d{4,}$/.test(t.accountNumber) || t.accountNumber.length > MAX_ACCOUNT) fail("treasury.accountNumber", `must contain digits only, 4 to ${MAX_ACCOUNT}`);
  url("treasury.qrUrl", t.qrUrl);
  url("treasury.deunaUrl", t.deunaUrl);
  url("treasury.helpUrl", t.helpUrl);
  if (t.qrUrl !== null && !t.qrUrl.startsWith("/")) fail("treasury.qrUrl", "must be null or a same-origin path starting with /");
  if (t.deunaUrl !== null && !/^https:\/\//.test(t.deunaUrl)) fail("treasury.deunaUrl", "must be null or an https URL");
  if (t.helpUrl !== null && !/^https:\/\//.test(t.helpUrl)) fail("treasury.helpUrl", "must be null or an https URL");

  if (config.banks.length === 0 || config.banks.some((b) => typeof b !== "string" || b.trim() === "")) fail("banks", "must be a non-empty list of names");
  if (config.banks.some((b) => b.length > MAX_TEXT)) fail("banks", `names must be at most ${MAX_TEXT} characters`);
  if (config.banks.some((b) => UNSAFE_CHARS.test(b))) fail("banks", "names must not contain control or bidirectional characters");
  if (new Set(config.banks).size !== config.banks.length) fail("banks", "must not contain duplicates");

  const date = config.earliestTransferDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail("earliestTransferDate", "must be a valid YYYY-MM-DD date");
  if (!/^#[0-9A-Fa-f]{6}$/.test(config.defaultTone)) fail("defaultTone", "must be a #RRGGBB color");

  const ga = config.analytics.gaMeasurementId;
  if (ga !== null && !/^G-[A-Z0-9]{4,20}$/.test(ga)) fail("analytics.gaMeasurementId", "must be null or look like G-XXXXXXXXXX");

  return config;
}

/** "2026-11-01" -> "noviembre de 2026" (Spanish month and year of the earliest accepted transfer). */
export function monthYearEs(isoDate: string): string {
  const [year, month] = isoDate.split("-");
  return `${MONTHS_ES[Number(month) - 1] ?? ""} de ${year}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const orNull = (value: unknown): unknown => (value === null || typeof value === "string" ? value : undefined);

/**
 * Turns untrusted JSON (a tenant's `config_json`) into a validated InstanceConfig. The shape is checked first, so a
 * missing or mistyped field is reported by name instead of crashing inside the rules, and ONLY the known fields are
 * copied: anything else in the row (a stray secret, an internal id) can never reach a response. Messages carry field
 * names and rules, never the offending values.
 */
export function parseInstanceConfig(raw: unknown, source: string): InstanceConfig {
  const bad = (field: string, expected: string): never => {
    throw new Error(`Invalid ${source}: ${field} must be ${expected}.`);
  };
  if (!isRecord(raw)) return bad("config", "an object");
  const { treasury, banks } = raw;
  const analytics = raw["analytics"] === undefined ? {} : raw["analytics"];
  if (!isRecord(treasury)) return bad("treasury", "an object");
  if (!isRecord(analytics)) return bad("analytics", "an object");
  if (!Array.isArray(banks)) return bad("banks", "a list");
  for (const field of ["schoolName", "className", "classShortName", "classMark", "earliestTransferDate", "defaultTone"]) {
    if (typeof raw[field] !== "string") bad(field, "a string");
  }
  for (const field of ["bank", "accountType", "accountNumber", "holder", "holderId"]) {
    if (typeof treasury[field] !== "string") bad(`treasury.${field}`, "a string");
  }
  // Optional: missing means null. qrUrl is not read at all, the ConfigStore derives it from the tenant's own asset.
  for (const field of ["deunaUrl", "helpUrl"]) {
    if (orNull(treasury[field] ?? null) === undefined) bad(`treasury.${field}`, "a string or null");
  }
  if (orNull(analytics["gaMeasurementId"] ?? null) === undefined) bad("analytics.gaMeasurementId", "a string or null");
  if (banks.some((b) => typeof b !== "string")) bad("banks", "a list of strings");

  const text = (o: Record<string, unknown>, k: string): string => o[k] as string;
  const link = (k: string): string | null => (treasury[k] ?? null) as string | null;
  return validateInstanceConfig(
    {
      schoolName: text(raw, "schoolName"),
      className: text(raw, "className"),
      classShortName: text(raw, "classShortName"),
      classMark: text(raw, "classMark"),
      treasury: {
        bank: text(treasury, "bank"),
        accountType: text(treasury, "accountType"),
        accountNumber: text(treasury, "accountNumber"),
        holder: text(treasury, "holder"),
        holderId: text(treasury, "holderId"),
        qrUrl: null,
        deunaUrl: link("deunaUrl"),
        helpUrl: link("helpUrl"),
      },
      banks: banks as string[],
      earliestTransferDate: text(raw, "earliestTransferDate"),
      defaultTone: text(raw, "defaultTone"),
      analytics: { gaMeasurementId: (analytics["gaMeasurementId"] ?? null) as string | null },
    },
    source,
  );
}
