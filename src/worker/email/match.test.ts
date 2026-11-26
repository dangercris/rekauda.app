import { describe, expect, it } from "vitest";
import { AUTO_LINK_THRESHOLD, ecuadorDay, nameSimilarity, pickMatch, scoreCandidate, tokens, type MatchCandidate, type MatchMovement } from "./match";

const movement: MatchMovement = {
  amountCents: 1400,
  receivedAt: "2026-11-26T14:02:00.000Z", // 09:02 in Ecuador, 26 nov
  payerName: "Torres Mendez Lucia Ana",
  originBank: "Coop. Jep",
};

const candidate = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: "p1",
  parentName: "Lucia Anais Torres Mendez",
  amountCents: 1400,
  transferDate: "2026-11-26",
  bank: "Cooperativa JEP",
  studentSurnames: ["Perez Torres"],
  ...overrides,
});

describe("helpers", () => {
  it("tokenizes without accents and drops one-letter tokens", () => {
    expect(tokens("Ñandú Pérez, J. de la Cruz")).toEqual(["nandu", "perez", "de", "la", "cruz"]);
  });

  it("converts an instant to the Ecuador calendar day", () => {
    expect(ecuadorDay("2026-11-27T02:30:00.000Z")).toBe("2026-11-26");
    expect(ecuadorDay("2026-11-26T05:00:00.000Z")).toBe("2026-11-26");
    expect(ecuadorDay("2026-11-26T04:59:00.000Z")).toBe("2026-11-25");
  });

  it("counts a partial token prefix as a match", () => {
    expect(nameSimilarity(["valeria", "ana"], ["valeria", "anabel"])).toBe(1);
    expect(nameSimilarity(["iri"], ["iris"])).toBeLessThan(1);
    expect(nameSimilarity(["ab"], ["abc"])).toBe(0);
  });
});

describe("scoreCandidate", () => {
  it("requires the exact amount", () => {
    expect(scoreCandidate(movement, candidate({ amountCents: 1500 }))).toBeNull();
  });

  it("requires the declared date inside the window", () => {
    expect(scoreCandidate(movement, candidate({ transferDate: "2026-11-27" }))).not.toBeNull(); // movement 1 day before
    expect(scoreCandidate(movement, candidate({ transferDate: "2026-11-24" }))).not.toBeNull(); // movement 2 days after
    expect(scoreCandidate(movement, candidate({ transferDate: "2026-11-23" }))).toBeNull();
    expect(scoreCandidate(movement, candidate({ transferDate: "2026-11-28" }))).toBeNull();
  });

  it("scores the same day higher than a nearby day", () => {
    const same = scoreCandidate(movement, candidate());
    const near = scoreCandidate(movement, candidate({ transferDate: "2026-11-25" }));
    expect(same).toBeGreaterThan(near ?? 1);
  });

  it("adds a bank bonus when the origin bank is mentioned", () => {
    const withBank = scoreCandidate(movement, candidate({ parentName: "Otra Persona", studentSurnames: [] }));
    const withoutBank = scoreCandidate(movement, candidate({ parentName: "Otra Persona", studentSurnames: [], bank: "Banco Guayaquil" }));
    expect((withBank ?? 0) - (withoutBank ?? 0)).toBeCloseTo(0.1, 5);
  });
});

describe("pickMatch", () => {
  it("links the single clear match (name via representative)", () => {
    const result = pickMatch(movement, [candidate()]);
    expect(result?.paymentId).toBe("p1");
    expect(result?.score).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
  });

  it("matches through the students' surnames when the representative differs", () => {
    const byStudent = candidate({ parentName: "Tutor Distinto", studentSurnames: ["Torres Mendez"] });
    expect(pickMatch(movement, [byStudent])?.paymentId).toBe("p1");
  });

  it("leaves two families with the same amount unmatched when neither name fits", () => {
    const a = candidate({ id: "a", parentName: "Familia Uno Lopez", studentSurnames: ["Lopez Uno"], bank: "Banco Guayaquil" });
    const b = candidate({ id: "b", parentName: "Familia Dos Castro", studentSurnames: ["Castro Dos"], bank: "Banco Guayaquil" });
    expect(pickMatch(movement, [a, b])).toBeNull();
  });

  it("leaves ambiguous matches unmatched (two candidates fit)", () => {
    expect(pickMatch(movement, [candidate({ id: "a" }), candidate({ id: "b" })])).toBeNull();
  });

  it("picks the right family among several with the same amount", () => {
    const other = candidate({ id: "other", parentName: "Familia Dos Castro", studentSurnames: ["Castro Dos"], bank: "Banco Guayaquil" });
    expect(pickMatch(movement, [other, candidate()])?.paymentId).toBe("p1");
  });

  it("does not link when the amount differs", () => {
    expect(pickMatch(movement, [candidate({ amountCents: 2800 })])).toBeNull();
  });

  it("does not link on a weak single-token name match without a bank hint", () => {
    const weak = candidate({ parentName: "Lucia Lopez", studentSurnames: ["Lopez"], bank: "Banco Guayaquil" });
    expect(pickMatch(movement, [weak])).toBeNull();
  });

  it("never auto-links on one shared common token, even with amount, day and bank", () => {
    const maria = { amountCents: 1400, receivedAt: "2026-11-26T14:02:00.000Z", payerName: "Maria Perez", originBank: "Coop. Jep" };
    const pending = candidate({ parentName: "Maria Gomez", studentSurnames: ["Gomez Salazar"], bank: "Cooperativa JEP" });
    expect(pickMatch(maria, [pending])).toBeNull();
    // It still ranks for the admin select.
    expect(scoreCandidate(maria, pending)).toBeGreaterThan(0.5);
  });

  it("does not let the bank bonus alone carry two weak name tokens over the threshold", () => {
    const m = { ...movement, payerName: "Lucia Ana Torres Mendez Soto Vera" };
    const c = candidate({ parentName: "Lucia Torres Pino Rojas Leon Cruz", studentSurnames: [], transferDate: "2026-11-25" });
    expect(scoreCandidate(m, c)).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    expect(pickMatch(m, [c])).toBeNull();
  });

  it("returns null without candidates", () => {
    expect(pickMatch(movement, [])).toBeNull();
  });
});
