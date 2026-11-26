import { describe, expect, it } from "vitest";
import { makeMovement, makePayment } from "../test/fixtures";
import { candidateLabel, candidatePayments } from "./movements";

const movement = makeMovement({ receivedAt: "2026-11-26T14:02:00.000Z", payerName: "Torres Mendez Lucia Ana", originBank: "Coop. Jep" });

describe("candidatePayments", () => {
  it("keeps only same-amount, non-void, unlinked payments, best match first", () => {
    const wrongAmount = makePayment({ amountCents: 2800 });
    const void_ = makePayment({ status: "anulado", parentName: "Lucia Anais Torres" });
    const linked = makePayment({
      parentName: "Lucia Anais Torres",
      bankMovement: { id: "m", transactionNumber: "1", amountCents: 1400, payerName: null, originBank: null, receivedAt: "2026-11-26T14:02:00.000Z", matchStatus: "auto" },
    });
    const other = makePayment({ parentName: "Familia Castro", transferDate: "2026-11-26", students: [{ givenNames: "Ana", surnames: "Castro", option: "mujer", optionLabel: "x" }] });
    const best = makePayment({ parentName: "Lucia Anais Torres", transferDate: "2026-11-26", bank: "Cooperativa JEP" });

    const ranked = candidatePayments(movement, [wrongAmount, void_, linked, other, best]);
    expect(ranked.map((r) => r.payment.id)).toEqual([best.id, other.id]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 1);
  });

  it("still offers payments whose declared date is far away, after the ones that fit", () => {
    const far = makePayment({ transferDate: "2026-10-01" });
    const near = makePayment({ transferDate: "2026-11-26" });
    const ranked = candidatePayments(movement, [far, near]);
    expect(ranked.map((r) => r.payment.id)).toEqual([near.id, far.id]);
    expect(ranked[1]?.score).toBeNull();
  });
});

describe("candidateLabel", () => {
  it("lists representative, students, date and code", () => {
    const payment = makePayment({ code: "ABC-123", parentName: "Carolina Vásquez" });
    expect(candidateLabel({ payment, score: 0.9 }, () => "25 nov")).toBe("Carolina Vásquez · Mateo Andrade · 25 nov · ABC-123");
  });
});
