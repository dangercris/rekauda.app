import type { InstanceConfig } from "./instance-config";

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Pure and dependency free: it runs when the config module loads, in the Worker, the client bundle and tests. */
export function validateInstanceConfig(config: InstanceConfig): InstanceConfig {
  const fail = (field: string, rule: string): never => {
    throw new Error(`Invalid rekauda.config.ts: ${field} ${rule}.`);
  };
  const text = (field: string, value: unknown): void => {
    if (typeof value !== "string" || value.trim() === "") fail(field, "must be a non-empty string");
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
  if (!/^\d{4,}$/.test(t.accountNumber)) fail("treasury.accountNumber", "must contain digits only, at least 4");
  if (t.qrUrl !== null && !t.qrUrl.startsWith("/")) fail("treasury.qrUrl", "must be null or a same-origin path starting with /");
  if (t.deunaUrl !== null && !/^https:\/\//.test(t.deunaUrl)) fail("treasury.deunaUrl", "must be null or an https URL");
  if (t.helpUrl !== null && !/^https:\/\//.test(t.helpUrl)) fail("treasury.helpUrl", "must be null or an https URL");

  if (config.banks.length === 0 || config.banks.some((b) => typeof b !== "string" || b.trim() === "")) fail("banks", "must be a non-empty list of names");
  if (new Set(config.banks).size !== config.banks.length) fail("banks", "must not contain duplicates");

  const date = config.earliestTransferDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail("earliestTransferDate", "must be a valid YYYY-MM-DD date");
  if (!/^#[0-9A-Fa-f]{6}$/.test(config.defaultTone)) fail("defaultTone", "must be a #RRGGBB color");

  const ga = config.analytics.gaMeasurementId;
  if (ga !== null && !/^G-[A-Z0-9]{4,}$/.test(ga)) fail("analytics.gaMeasurementId", "must be null or look like G-XXXXXXXXXX");

  return config;
}

/** "2026-11-01" -> "noviembre de 2026" (Spanish month and year of the earliest accepted transfer). */
export function monthYearEs(isoDate: string): string {
  const [year, month] = isoDate.split("-");
  return `${MONTHS_ES[Number(month) - 1] ?? ""} de ${year}`;
}
