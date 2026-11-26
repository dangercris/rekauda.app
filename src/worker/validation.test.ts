import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import {
  boundedText,
  cleanText,
  displayName,
  normalize,
  normalizeCode,
  parseAmount,
  parseCollectionFields,
  parseCollectionOptions,
  parseDeunaLink,
  parseDeunaLinkExpires,
  parsePhone,
  parseReference,
  parseStudents,
  parseTone,
  parseTransferDate,
  personName,
  sniffImage,
  sniffReceipt,
} from "./validation";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.code;
    throw e;
  }
  return "no-error";
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.message;
    throw e;
  }
  return "";
}

const OPTIONS = [
  { key: "mujer", label: "Vestuario de mujer", detail: null, cents: 1400 },
  { key: "hombre", label: "Vestuario de hombre", detail: null, cents: 1400 },
];

describe("text helpers", () => {
  it("cleanText collapses whitespace, strips control chars and slices", () => {
    expect(cleanText("  Ana \n\t  María\u0000 ", 60)).toBe("Ana María");
    expect(cleanText("abcdef", 3)).toBe("abc");
  });

  it("normalize drops accents and case", () => {
    expect(normalize("  María  JOSÉ ")).toBe("maria jose");
  });

  it("displayName is first given name + surname initial", () => {
    expect(displayName("Ana Lucía", "Mora Pérez")).toBe("Ana M.");
    expect(displayName("ana", "ñato")).toBe("ana Ñ.");
    expect(displayName("Ana", "")).toBe("Ana");
  });
});

describe("normalizeCode", () => {
  it("accepts any casing and separators", () => {
    expect(normalizeCode("k7q-4mp")).toBe("K7Q-4MP");
    expect(normalizeCode("k7q 4mp")).toBe("K7Q-4MP");
    expect(normalizeCode("K7Q4MP")).toBe("K7Q-4MP");
  });

  it("rejects wrong length and ambiguous characters", () => {
    expect(normalizeCode("K7Q-4M")).toBeNull();
    expect(normalizeCode("K7Q-4MPP")).toBeNull();
    expect(normalizeCode("K7Q-4M0")).toBeNull(); // 0, 1, I, L and O are not in the alphabet
    expect(normalizeCode("K7Q-4ML")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
});

describe("personName", () => {
  it("accepts accents, apostrophes and hyphens, normalizing curly quotes", () => {
    expect(personName("María-José  D’Alba", "x")).toBe("María-José D'Alba");
  });

  it.each(["", "A", "Ana123", "<b>x</b>", "1Ana", "x".repeat(2) + "!"])("rejects %j", (raw) => {
    expect(codeOf(() => personName(raw, "el nombre"))).toBe("invalid_name");
  });

  it("includes the label in the Spanish message", () => {
    expect(messageOf(() => personName("", "los apellidos"))).toContain("los apellidos");
  });
});

describe("parsePhone", () => {
  it.each([
    ["0991234567", "+593991234567"],
    ["099 123 4567", "+593991234567"],
    ["991234567", "+593991234567"],
    ["+593991234567", "+593991234567"],
    ["593991234567", "+593991234567"],
    ["(099) 123-4567", "+593991234567"],
    ["+34612345678", "+34612345678"],
  ])("normalizes %s", (raw, expected) => {
    expect(parsePhone(raw)).toBe(expected);
  });

  it.each(["", "12345", "0881234567", "abc", "+12"])("rejects %j", (raw) => {
    expect(codeOf(() => parsePhone(raw))).toBe("invalid_phone");
  });
});

describe("parseTransferDate (Ecuador UTC-5)", () => {
  // 2026-11-25 23:30 in Ecuador is 2026-11-26 04:30Z
  const now = Date.parse("2026-11-26T04:30:00Z");

  it("accepts today and tomorrow in Ecuador time", () => {
    expect(parseTransferDate("2026-11-25", now)).toBe("2026-11-25");
    expect(parseTransferDate("2026-11-26", now)).toBe("2026-11-26");
  });

  it("rejects dates after Ecuador tomorrow", () => {
    expect(codeOf(() => parseTransferDate("2026-11-27", now))).toBe("invalid_date");
  });

  it("rejects dates before the earliest transfer", () => {
    expect(codeOf(() => parseTransferDate("2026-10-31", now))).toBe("invalid_date");
    expect(parseTransferDate("2026-11-01", now)).toBe("2026-11-01");
  });

  it.each(["", "25/11/2026", "2026-13-01", "2026-02-30x", "hoy"])("rejects malformed %j", (raw) => {
    expect(codeOf(() => parseTransferDate(raw, now))).toBe("invalid_date");
  });
});

describe("parseAmount", () => {
  it.each([
    ["14", 1400],
    ["14.5", 1450],
    ["14,00", 1400],
    ["$ 28.00", 2800],
    ["1.00", 100],
    ["6000", 600000],
  ])("parses %s", (raw, cents) => {
    expect(parseAmount(raw)).toBe(cents);
  });

  it.each(["", "abc", "0.50", "6001", "14.555", "-5", "12345", "1,000.00"])("rejects %j", (raw) => {
    expect(codeOf(() => parseAmount(raw))).toBe("invalid_amount");
  });
});

describe("parseReference", () => {
  it("returns null when empty and trims otherwise", () => {
    expect(parseReference("   ")).toBeNull();
    expect(parseReference(" 123456 ")).toBe("123456");
    expect(parseReference("AB/12 #3-4.5")).toBe("AB/12 #3-4.5");
  });

  it("rejects symbols outside the allowed set", () => {
    expect(codeOf(() => parseReference("<script>"))).toBe("invalid_reference");
    expect(codeOf(() => parseReference("a;b"))).toBe("invalid_reference");
  });
});

describe("parseStudents", () => {
  const one = JSON.stringify([{ givenNames: "Ana", surnames: "Mora", option: "mujer" }]);

  it("resolves the option and cleans names", () => {
    const [s] = parseStudents(one, OPTIONS, 4);
    expect(s).toMatchObject({ givenNames: "Ana", surnames: "Mora", option: { key: "mujer", cents: 1400 } });
  });

  it("rejects bad JSON, empty and non-array input", () => {
    expect(codeOf(() => parseStudents("nope", OPTIONS, 4))).toBe("invalid_students");
    expect(codeOf(() => parseStudents("[]", OPTIONS, 4))).toBe("invalid_students");
    expect(codeOf(() => parseStudents("{}", OPTIONS, 4))).toBe("invalid_students");
  });

  it("enforces the per-payment maximum", () => {
    const many = JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ givenNames: `Ana${"x".repeat(i)}`, surnames: "Mora", option: "mujer" })));
    expect(codeOf(() => parseStudents(many, OPTIONS, 2))).toBe("too_many_students");
  });

  it("rejects unknown options and repeated students (accent/case-insensitive)", () => {
    const bad = JSON.stringify([{ givenNames: "Ana", surnames: "Mora", option: "otro" }]);
    expect(codeOf(() => parseStudents(bad, OPTIONS, 4))).toBe("invalid_option");
    const dup = JSON.stringify([
      { givenNames: "María", surnames: "Mora", option: "mujer" },
      { givenNames: "maria", surnames: "MORA", option: "hombre" },
    ]);
    expect(codeOf(() => parseStudents(dup, OPTIONS, 4))).toBe("repeated_student");
  });

  it("rejects invalid names", () => {
    const bad = JSON.stringify([{ givenNames: "", surnames: "Mora", option: "mujer" }]);
    expect(codeOf(() => parseStudents(bad, OPTIONS, 4))).toBe("invalid_name");
  });
});

describe("parseTone", () => {
  it("stores uppercase", () => {
    expect(parseTone("#c81e3a")).toBe("#C81E3A");
    expect(parseTone("#0aF0Bc")).toBe("#0AF0BC");
  });

  it.each(["", "C81E3A", "#C81E3", "#C81E3AA", "#GGGGGG", "red", "rgb(1,2,3)", 123, null, undefined, "#C81E3A; x"])("rejects %j", (raw) => {
    expect(codeOf(() => parseTone(raw))).toBe("invalid_collection");
  });
});

describe("collection fields", () => {
  const valid = {
    slug: "viaje-2026",
    title: "Viaje de fin de año",
    description: "Aporte para el paseo del curso.",
    deadline: "2026-12-10",
    options: [{ key: "estudiante", label: "Estudiante", cents: 2600 }],
  };

  it("parses a full create body and leaves tone undefined when omitted", () => {
    const out = parseCollectionFields(valid, true);
    expect(out.slug).toBe("viaje-2026");
    expect(out.options).toEqual([{ key: "estudiante", label: "Estudiante", detail: null, cents: 2600 }]);
    expect(out.tone).toBeUndefined();
  });

  it("validates and uppercases tone on create and update", () => {
    expect(parseCollectionFields({ ...valid, tone: "#1e50c8" }, true).tone).toBe("#1E50C8");
    expect(parseCollectionFields({ tone: "#1e50c8" }, false)).toEqual({ tone: "#1E50C8" });
    expect(codeOf(() => parseCollectionFields({ tone: "azul" }, false))).toBe("invalid_collection");
  });

  it("partial updates only touch given keys", () => {
    expect(parseCollectionFields({}, false)).toEqual({});
    expect(parseCollectionFields({ eyebrow: "" }, false)).toEqual({ eyebrow: null });
  });

  it("requires every field when creating", () => {
    expect(codeOf(() => parseCollectionFields({}, true))).toBe("invalid_collection");
  });

  it.each([
    [{ slug: "AB" }, "enlace"],
    [{ slug: "dos--guiones" }, "enlace"],
    [{ title: "ab" }, "título"],
    [{ description: "corta" }, "descripción"],
    [{ deadline: "2026-02-31x" }, "fecha"],
    [{ status: "borrada" }, "Estado"],
    [{ maxPerPayment: 7 }, "máximo"],
    [{ notes: ["a", "b", "c", "d", "e", "f", "g"] }, "notas"],
    [{ notes: ["x".repeat(201)] }, "nota"],
  ])("rejects %j", (patch, fragment) => {
    const fn = () => parseCollectionFields({ ...valid, ...patch }, true);
    expect(codeOf(fn)).toBe("invalid_collection");
    expect(messageOf(fn)).toContain(fragment);
  });

  it("validates options", () => {
    expect(codeOf(() => parseCollectionOptions([]))).toBe("invalid_collection");
    expect(codeOf(() => parseCollectionOptions([{ key: "Bad Key", label: "Ok", cents: 100 }]))).toBe("invalid_collection");
    expect(codeOf(() => parseCollectionOptions([{ key: "a", label: "Ok", cents: 99 }]))).toBe("invalid_collection");
    expect(codeOf(() => parseCollectionOptions([{ key: "a", label: "Ok", cents: 12.5 }]))).toBe("invalid_collection");
    expect(
      codeOf(() =>
        parseCollectionOptions([
          { key: "a", label: "Uno", cents: 100 },
          { key: "a", label: "Dos", cents: 100 },
        ]),
      ),
    ).toBe("invalid_collection");
  });

  it("boundedText rejects instead of truncating", () => {
    expect(boundedText("  hola   mundo ", 3, 20, "x")).toBe("hola mundo");
    expect(codeOf(() => boundedText("x".repeat(30), 1, 20, "x"))).toBe("invalid_collection");
    expect(codeOf(() => boundedText(5, 1, 20, "x"))).toBe("invalid_collection");
  });
});

describe("file sniffing", () => {
  const pad = (head: number[]) => Uint8Array.from([...head, ...new Array(Math.max(0, 16 - head.length)).fill(0)]);
  const jpeg = pad([0xff, 0xd8, 0xff, 0xe0]);
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Uint8Array.from([...new TextEncoder().encode("RIFF"), 1, 2, 3, 4, ...new TextEncoder().encode("WEBP"), 0, 0]);
  const pdf = Uint8Array.from([...new TextEncoder().encode("%PDF-1.7\n"), 0, 0, 0, 0]);
  const gif = Uint8Array.from([...new TextEncoder().encode("GIF89a"), ...new Array(12).fill(0)]);

  it("sniffImage recognises jpeg, png and webp by magic bytes", () => {
    expect(sniffImage(jpeg)).toEqual({ type: "image/jpeg", ext: "jpg" });
    expect(sniffImage(png)).toEqual({ type: "image/png", ext: "png" });
    expect(sniffImage(webp)).toEqual({ type: "image/webp", ext: "webp" });
  });

  it("sniffImage rejects pdf, gif, svg/html and short buffers", () => {
    expect(sniffImage(pdf)).toBeNull();
    expect(sniffImage(gif)).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImage(jpeg.subarray(0, 8))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it("sniffReceipt accepts images and pdf only", () => {
    expect(sniffReceipt(jpeg)?.ext).toBe("jpg");
    expect(sniffReceipt(png)?.ext).toBe("png");
    expect(sniffReceipt(webp)?.ext).toBe("webp");
    expect(sniffReceipt(pdf)).toEqual({ type: "application/pdf", ext: "pdf" });
    expect(sniffReceipt(gif)).toBeNull();
    expect(sniffReceipt(new TextEncoder().encode("%PDF-"))).toBeNull(); // too short
  });
});

const DEUNA_LINK =
  "https://pagar.deuna.app/H92p/U2FsdGVkX180tkszt2uINP1MwfWDwJofelUhz77PnJJlyvsbeaqwP6c9I3nfwiL64qufVmH8lrcL7+YE054oM+/mGPbBGyKw329aeNw1rjVZb8I1aqPApbj1FFj8vyyJtIobjBsH8X3adZBpmVtWLv+Q6AcjFvRZCKJtfY84BdfKO+4+wCEeB+ZQINX2fzAS1A0Jru1GOLNz2OoRvSugDA==";

describe("Deuna collection link", () => {
  const valid = {
    slug: "viaje-2026",
    title: "Viaje de fin de año",
    description: "Aporte para el paseo del curso.",
    deadline: "2026-12-10",
    options: [{ key: "estudiante", label: "Estudiante", cents: 2600 }],
  };

  it("accepts the real link byte for byte and trims surrounding spaces", () => {
    expect(parseDeunaLink(DEUNA_LINK)).toBe(DEUNA_LINK);
    expect(parseDeunaLink(`  ${DEUNA_LINK}\n`)).toBe(DEUNA_LINK);
    expect(parseCollectionFields({ ...valid, deunaLink: DEUNA_LINK, deunaLinkExpires: "2026-12-26" }, true)).toMatchObject({
      deunaLink: DEUNA_LINK,
      deunaLinkExpires: "2026-12-26",
    });
  });

  it("treats empty and null as no link, and drops the expiry with it", () => {
    expect(parseDeunaLink("")).toBeNull();
    expect(parseDeunaLink("   ")).toBeNull();
    expect(parseDeunaLink(null)).toBeNull();
    expect(parseCollectionFields({ deunaLink: null, deunaLinkExpires: "2026-12-26" }, false)).toEqual({ deunaLink: null, deunaLinkExpires: null });
    expect(parseCollectionFields({ deunaLink: "" }, false)).toEqual({ deunaLink: null, deunaLinkExpires: null });
  });

  it("rejects other domains, lookalikes, whitespace, long links and non-strings", () => {
    for (const bad of [
      "https://evil.example/https://pagar.deuna.app/x",
      "http://pagar.deuna.app/x",
      "https://pagar.deuna.app.evil.com/x",
      "https://pagar.deuna.app/",
      "pagar.deuna.app/x",
    ]) {
      expect(codeOf(() => parseDeunaLink(bad)), bad).toBe("invalid_collection");
    }
    expect(messageOf(() => parseDeunaLink("https://pagar.deuna.app/a b"))).toMatch(/espacios/);
    expect(codeOf(() => parseDeunaLink(`https://pagar.deuna.app/${"a".repeat(1000)}`))).toBe("invalid_collection");
    expect(codeOf(() => parseDeunaLink(`https://pagar.deuna.app/${"a".repeat(975)}`))).toBe("no-error");
    expect(codeOf(() => parseDeunaLink(42))).toBe("invalid_collection");
  });

  it("validates the expiry as a real calendar date", () => {
    expect(parseDeunaLinkExpires("2026-12-26")).toBe("2026-12-26");
    expect(parseDeunaLinkExpires("")).toBeNull();
    expect(parseDeunaLinkExpires(null)).toBeNull();
    for (const bad of ["2026-02-30", "2026-13-01", "26-12-26", "2026-12-26T00:00", 20261226]) {
      expect(codeOf(() => parseDeunaLinkExpires(bad)), String(bad)).toBe("invalid_collection");
    }
    expect(codeOf(() => parseCollectionFields({ deunaLink: DEUNA_LINK, deunaLinkExpires: "mañana" }, false))).toBe("invalid_collection");
  });

  it("leaves both fields untouched when absent", () => {
    expect(parseCollectionFields(valid, true).deunaLink).toBeUndefined();
    expect(parseCollectionFields({ deunaLinkExpires: "2026-12-26" }, false)).toEqual({ deunaLinkExpires: "2026-12-26" });
  });
});
