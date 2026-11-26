import { describe, expect, it } from "vitest";
import { activeDeunaLink, dedupeStudents, parseNotes, parseOptions, todayGuayaquil } from "./collections";
import type { StudentStatusRow } from "./rows";

const row = (over: Partial<StudentStatusRow>): StudentStatusRow => ({
  collection_id: "c1",
  given_names: "Ana",
  surnames: "Mora",
  option_key: "mujer",
  status: "en_revision",
  ...over,
});

describe("dedupeStudents", () => {
  it("keeps the best status per student (pagado > recibido > en_revision > observado > anulado)", () => {
    const out = dedupeStudents([
      row({ status: "observado" }),
      row({ status: "en_revision" }),
      row({ status: "pagado" }),
      row({ status: "recibido" }),
    ]);
    expect(out.get("c1")).toEqual([{ name: "Ana M.", sortKey: "mora ana", option: "mujer", status: "pagado" }]);
  });

  it("does not downgrade when a worse status arrives later", () => {
    const out = dedupeStudents([row({ status: "recibido" }), row({ status: "observado" })]);
    expect(out.get("c1")?.[0]?.status).toBe("recibido");
  });

  it("treats accents and case as the same student, and the winner brings its own option", () => {
    const out = dedupeStudents([
      row({ given_names: "María", surnames: "Pérez", option_key: "mujer", status: "en_revision" }),
      row({ given_names: "maria", surnames: "PEREZ", option_key: "hombre", status: "recibido" }),
    ]);
    const students = out.get("c1") ?? [];
    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({ option: "hombre", status: "recibido" });
  });

  it("separates collections and distinct students", () => {
    const out = dedupeStudents([
      row({}),
      row({ given_names: "Luis" }),
      row({ collection_id: "c2" }),
    ]);
    expect(out.get("c1")).toHaveLength(2);
    expect(out.get("c2")).toHaveLength(1);
  });
});

describe("stored JSON parsing", () => {
  it("parseOptions tolerates garbage", () => {
    expect(parseOptions("not json")).toEqual([]);
    expect(parseOptions("{}")).toEqual([]);
    expect(parseOptions('[{"key":"a","label":"A","detail":null,"cents":100}]')).toHaveLength(1);
  });

  it("parseNotes keeps only strings", () => {
    expect(parseNotes('["a",1,null,"b"]')).toEqual(["a", "b"]);
    expect(parseNotes("oops")).toEqual([]);
  });
});

describe("activeDeunaLink (America/Guayaquil, valid through the expiry day)", () => {
  const link = "https://pagar.deuna.app/abc+/def==";
  const row = { deuna_link: link, deuna_link_expires: "2026-12-26" };

  it("computes the Guayaquil calendar day, not the UTC one", () => {
    expect(todayGuayaquil(new Date("2026-12-27T04:59:59Z"))).toBe("2026-12-26");
    expect(todayGuayaquil(new Date("2026-12-27T05:00:00Z"))).toBe("2026-12-27");
  });

  it("shows the link on the expiry day itself, even late at night in Ecuador", () => {
    expect(activeDeunaLink(row, new Date("2026-12-26T05:00:00Z"))).toBe(link);
    expect(activeDeunaLink(row, new Date("2026-12-27T02:00:00Z"))).toBe(link);
    expect(activeDeunaLink(row, new Date("2026-12-27T04:59:59Z"))).toBe(link);
  });

  it("hides it from the first instant of the day after", () => {
    expect(activeDeunaLink(row, new Date("2026-12-27T05:00:00Z"))).toBeNull();
    expect(activeDeunaLink(row, new Date("2027-01-15T12:00:00Z"))).toBeNull();
  });

  it("returns null without a link and never expires without a date", () => {
    expect(activeDeunaLink({ deuna_link: null, deuna_link_expires: null }, new Date())).toBeNull();
    expect(activeDeunaLink({ deuna_link: null, deuna_link_expires: "2099-01-01" }, new Date())).toBeNull();
    expect(activeDeunaLink({ deuna_link: link, deuna_link_expires: null }, new Date("2030-01-01T00:00:00Z"))).toBe(link);
  });
});
