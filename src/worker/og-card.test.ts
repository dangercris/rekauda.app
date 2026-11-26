import { describe, expect, it } from "vitest";
import { TEST_INSTANCE, withInstance } from "./test/config";
import { buildOgCard, deadlineLabel, ogVersion, rgba, splitMoney, type OgCardSource } from "./og-card";

const row: OgCardSource = {
  slug: "vestuario-musical",
  title: "Vestuario del musical",
  eyebrow: "Musical de Navidad",
  options_json: JSON.stringify([{ key: "unico", label: "Vestuario", detail: null, cents: 1400 }]),
  deadline: "2026-12-02",
  status: "abierta",
  tone: "#C81E3A",
  cover_key: null,
  updated_at: "2026-11-26T06:00:00.000Z",
};

describe("splitMoney", () => {
  it("splits whole and cents with Ecuadorian separators", () => {
    expect(splitMoney(1400)).toEqual({ whole: "$14", cents: ",00" });
    expect(splitMoney(123456)).toEqual({ whole: "$1.234", cents: ",56" });
    expect(splitMoney(5)).toEqual({ whole: "$0", cents: ",05" });
  });
});

describe("deadlineLabel", () => {
  it("formats the day and month in Spanish", () => {
    expect(deadlineLabel("2026-12-02")).toBe("Hasta el 2 de diciembre");
    expect(deadlineLabel("2027-01-15T00:00:00Z")).toBe("Hasta el 15 de enero");
  });

  it("rejects invalid dates", () => {
    expect(deadlineLabel("2026-13-01")).toBeNull();
    expect(deadlineLabel("mañana")).toBeNull();
  });
});

describe("ogVersion", () => {
  it("is stable for the same row and changes with updated_at", () => {
    expect(ogVersion(row)).toBe(ogVersion({ ...row }));
    expect(ogVersion({ updated_at: "2026-11-27T00:00:00.000Z" })).not.toBe(ogVersion(row));
    expect(ogVersion({ updated_at: "garbage" })).toBe("10");
  });
});

describe("buildOgCard", () => {
  it("builds the single-price card for an open collection", () => {
    const card = buildOgCard(row, TEST_INSTANCE);
    expect(card).toMatchObject({
      school: "Mi Colegio · 1.º de Básica A",
      eyebrow: "Musical de Navidad",
      title: "Vestuario del musical",
      priceWhole: "$14",
      priceCents: ",00",
      pricePrefix: null,
      priceSuffix: "por estudiante",
      badge: "Hasta el 2 de diciembre",
      closed: false,
    });
    expect(card.colors.tone).toBe("#C81E3A");
    expect(card.colors.ink).toBe("#FFFFFF");
  });

  it("shows the lowest price with 'Desde' when options differ", () => {
    const card = buildOgCard({
      ...row,
      options_json: JSON.stringify([
        { key: "a", label: "A", detail: null, cents: 2500 },
        { key: "b", label: "B", detail: null, cents: 1250 },
      ]),
    }, TEST_INSTANCE);
    expect(card.priceWhole).toBe("$12");
    expect(card.priceCents).toBe(",50");
    expect(card.pricePrefix).toBe("Desde");
    expect(card.priceSuffix).toBeNull();
  });

  it("marks closed collections and falls back on bad tones", () => {
    const card = buildOgCard({ ...row, status: "cerrada", tone: "nope", eyebrow: "  " }, TEST_INSTANCE);
    expect(card.badge).toBe("Recaudación cerrada");
    expect(card.closed).toBe(true);
    expect(card.eyebrow).toBeNull();
    expect(card.colors.tone).toBe("#C81E3A");
  });

  it("takes school, class and default tone from the config it is given", () => {
    const other = withInstance({ schoolName: "School B", className: "Class B", defaultTone: "#1E3AC8" });
    const card = buildOgCard({ ...row, tone: "nope" }, other);
    expect(card.school).toBe("School B · Class B");
    expect(card.colors.tone).toBe("#1E3AC8");
  });

  it("uses dark ink on light tones", () => {
    expect(buildOgCard({ ...row, tone: "#F5D547" }, TEST_INSTANCE).colors.ink).toBe("#0E1117");
  });
});

describe("rgba", () => {
  it("converts hex to rgba", () => {
    expect(rgba("#C81E3A", 0.5)).toBe("rgba(200, 30, 58, 0.5)");
  });
});
