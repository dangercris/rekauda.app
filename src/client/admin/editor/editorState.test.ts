import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../lib/api";
import { makeCollection } from "../test/fixtures";
import {
  editorReducer,
  initEditor,
  isDirty,
  mapServerError,
  slugify,
  toInput,
  validateDraft,
  type EditorAction,
  type EditorState,
} from "./editorState";

const TONE = "#112233";

const run = (state: EditorState, ...actions: EditorAction[]): EditorState => actions.reduce(editorReducer, state);

function validNew(): EditorState {
  const start = initEditor(null, TONE);
  const uid = start.draft.options[0]?.uid ?? "";
  return run(
    start,
    { type: "field", field: "title", value: "Paseo al Cotopaxi 2026" },
    { type: "field", field: "description", value: "Salida en bus con almuerzo incluido." },
    { type: "field", field: "deadline", value: "2027-01-23" },
    { type: "option", uid, field: "label", value: "Estudiante" },
    { type: "option", uid, field: "price", value: "28,50" },
  );
}

describe("event editor state", () => {
  it("suggests the slug from the title until the slug is edited", () => {
    let s = run(initEditor(null, TONE), { type: "field", field: "title", value: "Ágape de Navidad: ¡5.º B!" });
    expect(s.draft.slug).toBe("agape-de-navidad-5-b");
    s = run(s, { type: "field", field: "slug", value: "navidad" }, { type: "field", field: "title", value: "Otro título" });
    expect(s.draft.slug).toBe("navidad");
    expect(slugify("x".repeat(60))).toHaveLength(48);
    expect(slugify("--Hola   Mundo--")).toBe("hola-mundo");
  });

  it("validates the slug format and length", () => {
    const base = validNew();
    expect(validateDraft(base.draft)).toEqual({});
    // Typing is normalized: uppercase and spaces become a valid slug.
    expect(run(base, { type: "field", field: "slug", value: "Mi Paseo" }).draft.slug).toBe("mi-paseo");
    for (const bad of ["ab", "doble--guion", "-inicio", "fin-", "ñandú", "x".repeat(49)]) {
      const s = run(base, { type: "field", field: "slug", value: bad });
      expect(validateDraft(s.draft).slug, bad).toBeDefined();
    }
  });

  it("derives option keys for new rows, keeps existing keys read-only, and rejects duplicates", () => {
    const edit = initEditor(makeCollection(), TONE);
    const locked = edit.draft.options[0];
    let s = run(edit, { type: "option", uid: locked?.uid ?? "", field: "label", value: "Vestido" }, { type: "option", uid: locked?.uid ?? "", field: "key", value: "otro" });
    expect(s.draft.options[0]?.key).toBe("mujer");
    s = run(s, { type: "addOption" });
    const added = s.draft.options[2];
    s = run(s, { type: "option", uid: added?.uid ?? "", field: "label", value: "Mujer " }, { type: "option", uid: added?.uid ?? "", field: "price", value: "10" });
    expect(s.draft.options[2]?.key).toBe("mujer");
    const errors = validateDraft(s.draft);
    expect(errors[`option:${added?.uid}:key`]).toMatch(/ya lo usa/);
  });

  it("accepts prices with comma or dot decimals and rejects out-of-range ones", () => {
    const s = validNew();
    const uid = s.draft.options[0]?.uid ?? "";
    const price = (value: string) => validateDraft(run(s, { type: "option", uid, field: "price", value }).draft)[`option:${uid}:price`];
    expect(price("14,00")).toBeUndefined();
    expect(price("14.5")).toBeUndefined();
    expect(price("$ 1.000,00")).toBeUndefined();
    expect(price("0,50")).toMatch(/\$1,00/);
    expect(price("catorce")).toMatch(/precio/);
    expect(toInput(run(s, { type: "option", uid, field: "price", value: "14,5" }).draft, TONE).options[0]?.cents).toBe(1450);
  });

  it("limits notes to six non-empty lines of 200 characters", () => {
    const s = validNew();
    const six = Array.from({ length: 6 }, (_, i) => `Nota ${i + 1}`).join("\n");
    expect(validateDraft(run(s, { type: "field", field: "notes", value: `${six}\n\n  \n` }).draft).notes).toBeUndefined();
    expect(validateDraft(run(s, { type: "field", field: "notes", value: `${six}\nNota 7` }).draft).notes).toMatch(/hasta 6/);
    expect(validateDraft(run(s, { type: "field", field: "notes", value: "x".repeat(201) }).draft).notes).toMatch(/200/);
    expect(toInput(run(s, { type: "field", field: "notes", value: " Uno \n\nDos" }).draft, TONE).notes).toEqual(["Uno", "Dos"]);
  });

  it("keeps between 1 and 6 options", () => {
    let s = initEditor(null, TONE);
    s = run(s, { type: "removeOption", uid: s.draft.options[0]?.uid ?? "" });
    expect(s.draft.options).toHaveLength(1);
    for (let i = 0; i < 8; i += 1) s = run(s, { type: "addOption" });
    expect(s.draft.options).toHaveLength(6);
  });

  it("tracks unsaved changes against the loaded collection", () => {
    const s = initEditor(makeCollection(), TONE);
    expect(isDirty(s)).toBe(false);
    expect(isDirty(run(s, { type: "tone", value: "#3d4fa3" }))).toBe(true);
    expect(isDirty(run(s, { type: "field", field: "title", value: "Vestuario del musical " }))).toBe(false);
    expect(isDirty(run(s, { type: "cover", change: { kind: "remove" } }))).toBe(true);
  });

  it("re-validates live only after the first save attempt", () => {
    let s = validNew();
    s = run(s, { type: "field", field: "title", value: "ab" });
    expect(s.errors.title).toBeUndefined();
    s = run(s, { type: "submitted", errors: validateDraft(s.draft) });
    expect(s.errors.title).toBeDefined();
    s = run(s, { type: "field", field: "title", value: "Abc" });
    expect(s.errors.title).toBeUndefined();
  });

  it("maps server rejections to fields", () => {
    const s = initEditor(makeCollection(), TONE);
    const second = s.draft.options[1]?.uid ?? "";
    expect(mapServerError(new ApiRequestError(409, "slug_taken", "Ya existe una recaudación con ese enlace."), s.draft).errors.slug).toMatch(/Ya existe/);
    expect(mapServerError(new ApiRequestError(409, "option_in_use", 'La opción "mujer" ya tiene estudiantes.'), s.draft).errors.options).toMatch(/mujer/);
    expect(mapServerError(new ApiRequestError(400, "invalid_collection", "Opción 2: el precio va de USD 1,00 a USD 1000,00."), s.draft).errors[`option:${second}:price`]).toMatch(/^El precio/);
    expect(mapServerError(new ApiRequestError(400, "invalid_collection", "La descripción debe tener entre 10 y 400 caracteres."), s.draft).errors.description).toBeDefined();
    expect(mapServerError(new ApiRequestError(500, "http_500", "Tuvimos un problema."), s.draft).formError).toBe("Tuvimos un problema.");
  });
});

describe("event editor Deuna link", () => {
  const LINK = "https://pagar.deuna.app/H92p/abc+/def==";

  it("sends the link and expiry in the request body, empty as null", () => {
    const base = validNew();
    expect(toInput(base.draft, TONE)).toMatchObject({ deunaLink: null, deunaLinkExpires: null });
    const s = run(base, { type: "field", field: "deunaLink", value: `  ${LINK} ` }, { type: "field", field: "deunaLinkExpires", value: "2026-12-26" });
    expect(validateDraft(s.draft)).toEqual({});
    expect(toInput(s.draft, TONE)).toMatchObject({ deunaLink: LINK, deunaLinkExpires: "2026-12-26" });
  });

  it("drops the expiry when there is no link", () => {
    const s = run(validNew(), { type: "field", field: "deunaLinkExpires", value: "2026-12-26" });
    expect(toInput(s.draft, TONE)).toMatchObject({ deunaLink: null, deunaLinkExpires: null });
  });

  it("loads an existing link and tracks it as unsaved changes", () => {
    const s = initEditor(makeCollection({ deunaLink: LINK, deunaLinkExpires: "2026-12-26" }), TONE);
    expect(s.draft).toMatchObject({ deunaLink: LINK, deunaLinkExpires: "2026-12-26" });
    expect(isDirty(s)).toBe(false);
    expect(isDirty(run(s, { type: "field", field: "deunaLinkExpires", value: "2026-12-27" }))).toBe(true);
  });

  it("validates domain, spaces and date like the Worker", () => {
    const base = validNew();
    const errors = (link: string, expires = "") =>
      validateDraft(run(base, { type: "field", field: "deunaLink", value: link }, { type: "field", field: "deunaLinkExpires", value: expires }).draft);
    expect(errors("https://otro.com/x").deunaLink).toBeDefined();
    expect(errors("https://pagar.deuna.app/a b").deunaLink).toMatch(/espacios/);
    expect(errors(LINK, "2026-02-30").deunaLinkExpires).toBeDefined();
    expect(errors(LINK, "2026-12-26")).toEqual({});
  });

  it("maps server rejections to the Deuna fields", () => {
    const d = initEditor(makeCollection(), TONE).draft;
    expect(mapServerError(new ApiRequestError(400, "invalid_collection", "El link de cobro de Deuna no debe tener espacios."), d).errors.deunaLink).toBeDefined();
    expect(mapServerError(new ApiRequestError(400, "invalid_collection", "Escribe una fecha de vencimiento válida para el link de Deuna."), d).errors.deunaLinkExpires).toBeDefined();
  });
});

describe("tenant default tone", () => {
  it("starts a new event with the tenant's tone", () => {
    expect(initEditor(null, "#0B7A73").draft.tone).toBe("#0B7A73");
    expect(initEditor(null, "#C81E3A").draft.tone).toBe("#C81E3A");
  });

  it("falls back to the tenant's tone for an invalid stored or typed tone", () => {
    const stored = initEditor(makeCollection({ tone: "not-a-color" }), "#0B7A73");
    expect(stored.draft.tone).toBe("#0B7A73");
    const broken = { ...initEditor(null, "#C81E3A").draft, tone: "zzz" };
    expect(toInput(broken, "#C81E3A").tone).toBe("#C81E3A");
    expect(toInput(broken, "#0B7A73").tone).toBe("#0B7A73");
  });

  it("keeps the tenant's tone when the editor resets after saving", () => {
    const s = run(initEditor(null, "#0B7A73"), { type: "reset", collection: null });
    expect(s.draft.tone).toBe("#0B7A73");
  });
});
