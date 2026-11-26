import { describe, expect, it } from "vitest";
import {
  dateTime,
  daysLeftLabel,
  daysUntil,
  formatBytes,
  formatMoney,
  initials,
  longDate,
  moneyParts,
  normalizeSearch,
  parseAmountCents,
  parseInstant,
  plainAmount,
  plural,
  relative,
  shortDate,
  timeAgo,
  todayEc,
} from "./format";

describe("money", () => {
  it("splits into parts with es-EC separators", () => {
    expect(moneyParts(169600)).toEqual({ negative: false, symbol: "$", int: "1.696", cents: "00" });
    expect(moneyParts(5)).toEqual({ negative: false, symbol: "$", int: "0", cents: "05" });
    expect(moneyParts(-1250).negative).toBe(true);
    expect(moneyParts(123456789).int).toBe("1.234.567");
  });

  it("formats full and compact amounts", () => {
    expect(formatMoney(1400)).toBe("$14,00");
    expect(formatMoney(169600)).toBe("$1.696,00");
    expect(formatMoney(31500, { compact: true })).toBe("$315");
    expect(formatMoney(31550, { compact: true })).toBe("$315,50");
  });

  it("formats plain amounts for the API", () => {
    expect(plainAmount(2800)).toBe("28.00");
    expect(plainAmount(169605)).toBe("1696.05");
  });

  it.each([
    ["14", 1400],
    ["14,00", 1400],
    ["14.5", 1450],
    ["14,5", 1450],
    ["$14", 1400],
    ["$ 14,00", 1400],
    ["USD 14.00", 1400],
    ["usd14", 1400],
    ["1.696,00", 169600],
    ["1,696.00", 169600],
    ["1.696", 169600],
    ["0,05", 5],
  ])("parses %s", (input, cents) => {
    expect(parseAmountCents(input)).toBe(cents);
  });

  it.each(["", "abc", "-14", "14,0055", "1.2.3", "14,00.5", ".5", "1,69,6"])("rejects %s", (input) => {
    expect(parseAmountCents(input)).toBeNull();
  });
});

describe("text helpers", () => {
  it("pluralizes with thousands", () => {
    expect(plural(1, "estudiante", "estudiantes")).toBe("1 estudiante");
    expect(plural(32, "estudiante", "estudiantes")).toBe("32 estudiantes");
    expect(plural(1200, "pago", "pagos")).toBe("1.200 pagos");
  });

  it("derives initials", () => {
    expect(initials("Mateo Andrade")).toBe("MA");
    expect(initials("  ana   lucía pérez ")).toBe("AP");
    expect(initials("Émilie")).toBe("É");
    expect(initials("")).toBe("");
  });

  it("normalizes search strings", () => {
    expect(normalizeSearch("  José  ÁLVAREZ ")).toBe("jose alvarez");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(248 * 1024)).toBe("248 KB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1,2 MB");
  });
});

describe("Ecuador dates (UTC-5)", () => {
  it("rolls the day at 05:00 UTC, not at UTC midnight", () => {
    expect(todayEc(new Date("2026-12-02T04:59:59Z"))).toBe("2026-12-01");
    expect(todayEc(new Date("2026-12-02T05:00:00Z"))).toBe("2026-12-02");
  });

  it("counts days until a deadline around Ecuador midnight", () => {
    const lateNight = new Date("2026-12-12T04:30:00Z"); // 11 Dec, 23:30 in Ecuador
    expect(daysUntil("2026-12-12", lateNight)).toBe(1);
    const justAfter = new Date("2026-12-12T05:10:00Z"); // 12 Dec, 00:10 in Ecuador
    expect(daysUntil("2026-12-12", justAfter)).toBe(0);
    expect(daysUntil("2026-12-10", justAfter)).toBe(-2);
    expect(daysUntil("2026-02-30", justAfter)).toBeNaN();
  });

  it("labels the countdown", () => {
    expect(daysLeftLabel(16)).toBe("Faltan 16 días");
    expect(daysLeftLabel(1)).toBe("Falta 1 día");
    expect(daysLeftLabel(0)).toBe("Último día");
    expect(daysLeftLabel(-1)).toBe("Plazo vencido");
  });

  it("formats long and short dates", () => {
    expect(longDate("2026-12-02")).toBe("miércoles 2 de diciembre");
    expect(longDate("2026-12-02", true)).toBe("miércoles 2 de diciembre de 2026");
    expect(shortDate("2026-12-12")).toBe("sáb 12 dic");
    expect(longDate("2026-12-03T03:00:00Z")).toBe("miércoles 2 de diciembre");
  });

  it("parses zone-less SQLite timestamps as UTC", () => {
    expect(parseInstant("2026-11-26 15:42:00")?.toISOString()).toBe("2026-11-26T15:42:00.000Z");
    expect(parseInstant("garbage")).toBeNull();
  });

  it("formats date-times and relative labels in Ecuador time", () => {
    expect(dateTime("2026-11-26T15:38:00Z")).toBe("26 nov 2026 · 10:38");
    const now = new Date("2026-11-26T17:00:00Z");
    expect(relative("2026-11-26T15:42:00Z", now)).toBe("Hoy · 10:42");
    expect(relative("2026-11-26T04:30:00Z", now)).toBe("Ayer · 23:30");
    expect(relative("2026-10-03T15:00:00Z", now)).toBe("3 oct · 10:00");
    expect(relative("2025-10-03T15:00:00Z", now)).toBe("3 oct 2025 · 10:00");
  });

  it("formats time ago", () => {
    const now = new Date("2026-11-26T17:00:00Z");
    expect(timeAgo("2026-11-26T16:59:40Z", now)).toBe("hace un momento");
    expect(timeAgo("2026-11-26T16:37:00Z", now)).toBe("hace 23 min");
    expect(timeAgo("2026-11-26T14:00:00Z", now)).toBe("hace 3 h");
    expect(timeAgo("2026-11-25T20:00:00Z", now)).toBe("ayer");
    expect(timeAgo("2026-11-22T20:00:00Z", now)).toBe("hace 4 días");
    expect(timeAgo("2026-11-01T20:00:00Z", now)).toBe("1 nov");
  });
});
