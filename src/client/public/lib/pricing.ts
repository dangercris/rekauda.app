import type { CollectionOption } from "../../../shared/api";
import { formatMoney } from "../../lib/format";

/** The price every option shares, or null when options have different prices (or there are none). */
export function uniformCents(options: readonly CollectionOption[]): number | null {
  const first = options[0];
  if (!first) return null;
  return options.every((o) => o.cents === first.cents) ? first.cents : null;
}

export interface PriceRange {
  min: number;
  max: number;
}

export function priceRange(options: readonly CollectionOption[]): PriceRange {
  if (options.length === 0) return { min: 0, max: 0 };
  const prices = options.map((o) => o.cents);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Card summary: "$14,00 por estudiante" or "Desde $10,00". */
export function priceSummary(options: readonly CollectionOption[]): string {
  const unit = uniformCents(options);
  if (unit !== null) return `${formatMoney(unit)} por estudiante`;
  return `Desde ${formatMoney(priceRange(options).min)}`;
}

/** "$10,00 a $35,00 cada uno, según la opción". */
export function priceRangeText(options: readonly CollectionOption[]): string {
  const { min, max } = priceRange(options);
  return `${formatMoney(min)} a ${formatMoney(max)} cada uno, según la opción`;
}

export interface ExpectedTotal {
  total: number;
  /** False while some student has no (valid) option yet. */
  complete: boolean;
}

/** Expected amount for a list of students. With a uniform price the options do not matter. */
export function expectedTotal(students: ReadonlyArray<{ option: string | null }>, options: readonly CollectionOption[]): ExpectedTotal {
  const unit = uniformCents(options);
  if (unit !== null) return { total: unit * students.length, complete: students.length > 0 };
  const byKey = new Map(options.map((o) => [o.key, o.cents]));
  let total = 0;
  let complete = students.length > 0;
  for (const student of students) {
    const cents = student.option === null ? undefined : byKey.get(student.option);
    if (cents === undefined) complete = false;
    else total += cents;
  }
  return { total, complete };
}

export function optionLabel(options: readonly CollectionOption[], key: string): string {
  return options.find((o) => o.key === key)?.label ?? key;
}
