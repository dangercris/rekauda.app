import { describe, expect, it } from "vitest";
import {
  amountProblem,
  isPersonName,
  isValidPhone,
  isValidReference,
  summarize,
  transferDateProblem,
  validatePayment,
  type PaymentValues,
} from "./validation";

const NOW = new Date("2026-11-26T17:00:00Z"); // 12:00 in Ecuador

const valid: PaymentValues = {
  students: [{ givenNames: "Mateo José", surnames: "Andrade", option: "mujer" }],
  hasReceipt: true,
  amount: "14,00",
  transferDate: "2026-11-26",
  bank: "Produbanco",
  reference: "",
  parentName: "Carolina Vásquez",
  phone: "0991234567",
  consent: true,
};

const ctx = { optionKeys: ["mujer", "hombre"], banks: ["Produbanco"], now: NOW };

describe("validation mirrors the server", () => {
  it("person names: letters, marks, spaces . ' - ; 2..60; curly apostrophes normalized", () => {
    expect(isPersonName("María José")).toBe(true);
    expect(isPersonName("O’Brien")).toBe(true);
    expect(isPersonName("Jean-Luc")).toBe(true);
    expect(isPersonName("  Ana  ")).toBe(true);
    expect(isPersonName("A")).toBe(false);
    expect(isPersonName("Ana2")).toBe(false);
    expect(isPersonName("-Ana")).toBe(false);
    expect(isPersonName("")).toBe(false);
  });

  it("phones: Ecuador mobile or +international, separators ignored", () => {
    for (const ok of ["0991234567", "099 123 4567", "+593991234567", "593991234567", "+5930991234567", "(099) 123-4567", "+14155550123"]) {
      expect(isValidPhone(ok)).toBe(true);
    }
    for (const bad of ["072345678", "09912345", "abc", "+593", ""]) expect(isValidPhone(bad)).toBe(false);
  });

  it("transfer date: required, not future (Ecuador calendar), not before Nov 2026", () => {
    expect(transferDateProblem("2026-11-26", NOW)).toBeNull();
    expect(transferDateProblem("2026-11-27", NOW)).toBe("future");
    expect(transferDateProblem("2026-10-31", NOW)).toBe("too_old");
    expect(transferDateProblem("", NOW)).toBe("missing");
    // 23:30 Ecuador on the 26th is already the 27th in UTC: the 26th is still "today".
    expect(transferDateProblem("2026-11-26", new Date("2026-11-27T04:30:00Z"))).toBeNull();
  });

  it("amounts: 14,00 / $14 / USD 14.00, between $1 and $6.000", () => {
    expect(amountProblem("14,00")).toBeNull();
    expect(amountProblem("$14")).toBeNull();
    expect(amountProblem("USD 14.00")).toBeNull();
    expect(amountProblem("abc")).toBe("invalid");
    expect(amountProblem("0,50")).toBe("range");
    expect(amountProblem("7000")).toBe("range");
  });

  it("reference: optional, letters, numbers and . / # -", () => {
    expect(isValidReference("")).toBe(true);
    expect(isValidReference("0045 8812")).toBe(true);
    expect(isValidReference("TRX#12/3")).toBe(true);
    expect(isValidReference("<script>")).toBe(false);
  });

  it("returns no issues for a valid form", () => {
    expect(validatePayment(valid, ctx)).toEqual([]);
  });

  it("lists every problem in form order with field keys", () => {
    const issues = validatePayment(
      {
        ...valid,
        students: [
          { givenNames: "", surnames: "Andrade", option: null },
          { givenNames: "Ana", surnames: "R2", option: "hombre" },
        ],
        hasReceipt: false,
        amount: "",
        bank: "",
        phone: "123",
        consent: false,
      },
      ctx,
    );
    expect(issues.map((i) => i.field)).toEqual([
      "students.0.givenNames",
      "students.0.option",
      "students.1.surnames",
      "receipt",
      "amount",
      "bank",
      "phone",
      "consent",
    ]);
    expect(issues[0]?.summary).toBe("Revisa los nombres del estudiante 1.");
    expect(summarize(issues)).toBe("Revisa 8 campos marcados. Revisa los nombres del estudiante 1.");
  });

  it("flags a repeated student like the server (accents and case ignored)", () => {
    const issues = validatePayment(
      { ...valid, students: [valid.students[0]!, { givenNames: "mateo jose", surnames: "ANDRADE", option: "hombre" }] },
      ctx,
    );
    expect(issues).toEqual([expect.objectContaining({ field: "students.1.givenNames" })]);
  });

  it("only checks the bank against the list once it is known", () => {
    expect(validatePayment({ ...valid, bank: "Banco X" }, ctx).map((i) => i.field)).toEqual(["bank"]);
    expect(validatePayment({ ...valid, bank: "Banco X" }, { ...ctx, banks: null })).toEqual([]);
  });
});
