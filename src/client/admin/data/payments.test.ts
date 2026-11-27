import { describe, expect, it } from "vitest";
import { makePayment } from "../test/fixtures";
import { paymentsCsv } from "./csv";
import { countByStatus, filterPayments, groupByDay, matchesSearch, nextInQueue, paymentFlags, recentActivity } from "./payments";

const list = [
  makePayment({ id: "p1", code: "AAA-111", status: "en_revision", parentName: "Carolina Vásquez", createdAt: "2026-11-26T14:00:00Z" }),
  makePayment({
    id: "p2",
    code: "BBB-222",
    status: "recibido",
    parentName: "Jorge Ruiz",
    reference: "0045 8812",
    students: [
      { givenNames: "Valentina", surnames: "Ruiz", option: "mujer", optionLabel: "Vestuario de mujer" },
      { givenNames: "Tomás", surnames: "Ruiz", option: "hombre", optionLabel: "Vestuario de hombre" },
    ],
    createdAt: "2026-11-26T02:00:00Z",
  }),
  makePayment({ id: "p3", status: "en_revision", parentName: "Daniela Ortiz", createdAt: "2026-11-24T15:00:00Z" }),
  makePayment({ id: "p4", status: "anulado", parentName: "Luis Salazar", createdAt: "2026-11-20T15:00:00Z" }),
];

describe("payment list helpers", () => {
  it("counts every status and the total", () => {
    expect(countByStatus(list)).toEqual({ todos: 4, en_revision: 2, recibido: 1, observado: 0, pagado: 0, anulado: 1 });
    expect(countByStatus([])).toMatchObject({ todos: 0, pagado: 0 });
  });

  it("searches students, representative, code and reference without accents or case", () => {
    expect(matchesSearch(list[1]!, "tomas")).toBe(true);
    expect(matchesSearch(list[1]!, "RUIZ valentina")).toBe(true);
    expect(matchesSearch(list[0]!, "vasquez")).toBe(true);
    expect(matchesSearch(list[0]!, "aaa111")).toBe(true);
    expect(matchesSearch(list[1]!, "8812")).toBe(true);
    expect(matchesSearch(list[1]!, "mujer")).toBe(true);
    expect(matchesSearch(list[0]!, "salazar")).toBe(false);
    expect(matchesSearch(list[0]!, "   ")).toBe(true);
  });

  it("filters by status and text together", () => {
    expect(filterPayments(list, "en_revision", "").map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(filterPayments(list, "todos", "ruiz").map((p) => p.id)).toEqual(["p2"]);
    expect(filterPayments(list, "pagado", "")).toEqual([]);
  });

  it("groups by Ecuador day with Hoy and Ayer labels", () => {
    const groups = groupByDay(list, new Date("2026-11-26T20:00:00Z"));
    expect(groups.map((g) => g.label)).toEqual(["Hoy", "Ayer", "Mar 24 nov", "Vie 20 nov"]);
    // 02:00 UTC on the 26th is still the 25th in Ecuador.
    expect(groups[1]?.items.map((p) => p.id)).toEqual(["p2"]);
  });

  it("lists flags with labels", () => {
    const flagged = makePayment({ flags: { amountMismatch: true, duplicateReceipt: false, duplicateReference: true } });
    expect(paymentFlags(flagged).map((f) => f.label)).toEqual(["Monto distinto", "Referencia repetida"]);
  });

  it("finds the next payment of the same queue, wrapping, then falls back to the review queue", () => {
    expect(nextInQueue(list, "p1", "en_revision")).toBe("p3");
    expect(nextInQueue(list, "p3", "en_revision")).toBe("p1");
    expect(nextInQueue(list, "p2", "recibido")).toBe("p3");
    expect(nextInQueue([list[1]!], "p2", "recibido")).toBeNull();
  });

  it("attributes reviews by an opaque user id to the treasury and Deuna reviews to automation", () => {
    const byUser = makePayment({ id: "u1", status: "pagado", reviewedBy: "u0000000-0000-4000-8000-00000000000a", reviewedAt: "2026-11-26T18:00:00Z" });
    const byDeuna = makePayment({ id: "d1", status: "recibido", reviewedBy: "deuna", reviewedAt: "2026-11-26T17:00:00Z" });
    const feed = recentActivity([byUser, byDeuna], 4);
    expect(feed.find((i) => i.paymentId === "u1" && i.kind === "pagado")?.actor).toBe("admin");
    expect(feed.find((i) => i.paymentId === "d1" && i.kind === "recibido")?.actor).toBe("auto");
  });

  it("attributes script reviews (imported rows) to automation, matching the reviewer label", () => {
    const byScript = makePayment({ id: "s1", status: "pagado", reviewedBy: "script", reviewedAt: "2026-11-26T16:00:00Z" });
    const feed = recentActivity([byScript], 4);
    expect(feed.find((i) => i.paymentId === "s1" && i.kind === "pagado")?.actor).toBe("auto");
  });

  it("builds the activity feed newest first", () => {
    const reviewed = makePayment({ id: "r1", status: "observado", reviewedBy: "admin", reviewedAt: "2026-11-26T18:00:00Z", reviewNote: "Monto incompleto" });
    const feed = recentActivity([reviewed, ...list], 3);
    expect(feed[0]).toMatchObject({ paymentId: "r1", kind: "observado", actor: "admin", note: "Monto incompleto" });
    expect(feed).toHaveLength(3);
  });

  it("exports CSV for Excel with escaping and formula neutralization", () => {
    const csv = paymentsCsv([makePayment({ parentName: '=HYPERLINK("x")', reviewNote: "Uno; dos", amountCents: 169600 })]);
    expect(csv.startsWith("﻿Código;Estado")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Uno; dos"');
    expect(csv).toContain(";1696,00;");
  });
});
