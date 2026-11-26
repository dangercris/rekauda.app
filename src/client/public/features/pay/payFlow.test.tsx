import { describe, expect, it } from "vitest";
import { gift, musical, pngFile, trip } from "../../test/fixtures";
import { initPayState, payReducer, selectAmount, submitLabel, syncStudentsToCount, toDraft, type PayAction, type PayState } from "./payFlow";

const TODAY = "2026-11-26";

function run(state: PayState, ...actions: PayAction[]): PayState {
  return actions.reduce(payReducer, state);
}

const fresh = (collection = musical) => initPayState({ options: collection.options, maxPerPayment: collection.maxPerPayment, today: TODAY });

describe("pay flow reducer", () => {
  it("starts on step 1 with one empty student and today's date", () => {
    const state = fresh();
    expect(state.step).toBe(1);
    expect(state.students).toHaveLength(1);
    expect(state.fields.transferDate).toBe(TODAY);
    expect(state.students[0]?.option).toBeNull();
  });

  it("preselects the only option of single-option collections", () => {
    const state = run(fresh(gift), { type: "setCount", count: 2 }, { type: "goTo", step: 2 });
    expect(state.students.map((s) => s.option)).toEqual(["aporte", "aporte"]);
  });

  it("clamps the counter to 1..maxPerPayment", () => {
    expect(run(fresh(), { type: "setCount", count: 9 }).count).toBe(4);
    expect(run(fresh(), { type: "setCount", count: 0 }).count).toBe(1);
  });

  it("entering step 2 adds blocks up to the counter", () => {
    const state = run(fresh(), { type: "setCount", count: 3 }, { type: "goTo", step: 2 });
    expect(state.step).toBe(2);
    expect(state.direction).toBe("forward");
    expect(state.students).toHaveLength(3);
    expect(state.count).toBe(3);
  });

  it("never deletes filled blocks when the counter goes down; the counter follows the blocks", () => {
    let state = run(fresh(), { type: "setCount", count: 3 }, { type: "goTo", step: 2 });
    const [a, b, c] = state.students;
    state = run(
      state,
      { type: "updateStudent", id: a?.id ?? 0, field: "givenNames", value: "Ana" },
      { type: "updateStudent", id: c?.id ?? 0, field: "surnames", value: "Mora" },
      { type: "goTo", step: 1 },
      { type: "setCount", count: 1 },
      { type: "goTo", step: 2 },
    );
    // Filled blocks (a, c) survive; only the empty block above the counter (b) goes.
    expect(state.students.map((s) => s.id)).toEqual([a?.id, c?.id]);
    expect(state.students.map((s) => s.id)).not.toContain(b?.id);
    expect(state.count).toBe(2);
  });

  it("drops trailing empty blocks above the counter", () => {
    let state = run(fresh(), { type: "setCount", count: 3 }, { type: "goTo", step: 2 });
    const first = state.students[0];
    state = run(state, { type: "updateStudent", id: first?.id ?? 0, field: "givenNames", value: "Ana" }, { type: "goTo", step: 1 }, { type: "setCount", count: 1 });
    state = syncStudentsToCount(state);
    expect(state.students).toHaveLength(1);
    expect(state.students[0]?.givenNames).toBe("Ana");
    expect(state.count).toBe(1);
  });

  it("add and remove keep the counter in sync and respect the maximum", () => {
    let state = run(fresh(trip), { type: "goTo", step: 2 }, { type: "addStudent" }, { type: "addStudent" }, { type: "addStudent" });
    expect(state.students).toHaveLength(3);
    expect(state.count).toBe(3);
    state = run(state, { type: "removeStudent", id: state.students[1]?.id ?? 0 });
    expect(state.students).toHaveLength(2);
    expect(state.count).toBe(2);
    state = run(state, { type: "removeStudent", id: state.students[0]?.id ?? 0 }, { type: "removeStudent", id: state.students[1]?.id ?? 0 });
    expect(state.students).toHaveLength(1);
  });

  it("clears a field error when the field changes and hides the summary when none remain", () => {
    let state = run(fresh(), {
      type: "invalid",
      summary: "Revisa 2 campos marcados.",
      issues: [
        { field: "phone", message: "x", summary: "x" },
        { field: "bank", message: "y", summary: "y" },
      ],
    });
    state = run(state, { type: "setField", field: "phone", value: "0991234567" });
    expect(state.errors.phone).toBeUndefined();
    expect(state.summary).not.toBeNull();
    state = run(state, { type: "setField", field: "bank", value: "Produbanco" });
    expect(state.summary).toBeNull();
  });

  it("a failed receipt replacement never keeps the previous file", () => {
    const file = pngFile();
    let state = run(fresh(), { type: "receiptReady", file });
    expect(state.receipt?.file).toBe(file);
    state = run(state, { type: "receiptProcessing", file: pngFile("otra.heic") }, { type: "receiptFailed", message: "No pudimos leer esa imagen." });
    expect(state.receipt).toBeNull();
    expect(state.receiptError).toMatch(/No pudimos leer/);
  });

  it("after a successful submit keeps the representative's name, phone and bank only", () => {
    let state = run(
      fresh(),
      { type: "goTo", step: 2 },
      { type: "setField", field: "parentName", value: "Carolina Vásquez" },
      { type: "setField", field: "phone", value: "0991234567" },
      { type: "setField", field: "bank", value: "Produbanco" },
      { type: "setField", field: "reference", value: "123" },
      { type: "setField", field: "amount", value: "20" },
      { type: "setConsent", value: true },
      { type: "receiptReady", file: pngFile() },
      { type: "submitStart" },
    );
    state = run(state, { type: "submitSuccess", result: { code: "ABC-234", students: [], amountCents: 2000 }, today: TODAY });
    expect(state.step).toBe(3);
    expect(state.result?.code).toBe("ABC-234");
    expect(state.fields).toMatchObject({ parentName: "Carolina Vásquez", phone: "0991234567", bank: "Produbanco", reference: "", amount: "", amountTouched: false, consent: false });
    expect(state.receipt).toBeNull();
    state = run(state, { type: "startAnother" });
    expect(state.step).toBe(1);
    expect(state.students).toHaveLength(1);
  });
});

describe("amount auto-fill and mismatch", () => {
  it("fills the expected total for uniform prices until the person types", () => {
    let state = run(fresh(), { type: "setCount", count: 2 }, { type: "goTo", step: 2 });
    let amount = selectAmount(state, musical.options);
    expect(amount.value).toBe("28,00");
    expect(amount.mismatch).toBe(false);
    expect(submitLabel(amount)).toBe("Registrar pago · $28,00");

    state = run(state, { type: "addStudent" });
    expect(selectAmount(state, musical.options).value).toBe("42,00");

    state = run(state, { type: "setField", field: "amount", value: "$14" });
    amount = selectAmount(state, musical.options);
    expect(amount.cents).toBe(1400);
    expect(amount.mismatch).toBe(true);
    expect(submitLabel(amount)).toBe("Registrar pago · $14,00");

    // Once edited, adding students no longer overwrites the amount.
    state = run(state, { type: "addStudent" });
    expect(selectAmount(state, musical.options).value).toBe("$14");
  });

  it("accepts 14,00 / $14 / USD 14.00 as the same amount", () => {
    for (const typed of ["14,00", "$14", "USD 14.00"]) {
      const state = run(fresh(gift), { type: "setField", field: "amount", value: typed });
      expect(selectAmount(state, gift.options).cents).toBe(1400);
    }
  });

  it("waits for every option with mixed prices", () => {
    let state = run(fresh(trip), { type: "setCount", count: 2 }, { type: "goTo", step: 2 });
    expect(selectAmount(state, trip.options)).toMatchObject({ value: "", expected: { complete: false } });
    expect(submitLabel(selectAmount(state, trip.options))).toBe("Registrar pago");
    const [a, b] = state.students;
    state = run(
      state,
      { type: "updateStudent", id: a?.id ?? 0, field: "option", value: "estudiante" },
      { type: "updateStudent", id: b?.id ?? 0, field: "option", value: "acompanante" },
    );
    expect(selectAmount(state, trip.options)).toMatchObject({ value: "61,00", cents: 6100, mismatch: false });
  });
});

describe("draft shape", () => {
  it("restores step 2, students, fields and a valid bank; never a future date or the file", () => {
    const base = run(
      fresh(),
      { type: "setCount", count: 2 },
      { type: "goTo", step: 2 },
      { type: "setField", field: "bank", value: "Produbanco" },
      { type: "setField", field: "transferDate", value: "2026-12-31" },
      { type: "receiptReady", file: pngFile() },
    );
    const draft = toDraft(base);
    expect(draft).not.toHaveProperty("receipt");
    const restored = initPayState({ options: musical.options, maxPerPayment: 4, today: TODAY, draft });
    expect(restored.step).toBe(2);
    expect(restored.students).toHaveLength(2);
    expect(restored.fields.bank).toBe("Produbanco");
    expect(restored.fields.transferDate).toBe(TODAY);
    expect(restored.receipt).toBeNull();
  });
});
