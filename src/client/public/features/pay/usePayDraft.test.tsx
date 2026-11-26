import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { musical } from "../../test/fixtures";
import { draftKey, initPayState, payReducer, type PayAction, type PayState } from "./payFlow";
import { DRAFT_DEBOUNCE_MS, loadDraft, usePayDraft } from "./usePayDraft";
import { useReducer } from "react";

const TODAY = "2026-11-26";

function useHarness(enabled = true) {
  const [state, dispatch] = useReducer(payReducer, undefined, () =>
    initPayState({ options: musical.options, maxPerPayment: 4, today: TODAY, draft: loadDraft(musical.slug) }),
  );
  usePayDraft(musical.slug, state, enabled);
  return { state, dispatch };
}

const send = (dispatch: (a: PayAction) => void, ...actions: PayAction[]) => act(() => actions.forEach((a) => dispatch(a)));

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("draft persistence", () => {
  it("saves with a debounce and restores after a reload (parents come back from the Deuna app)", () => {
    const first = renderHook(() => useHarness());
    send(
      first.result.current.dispatch,
      { type: "setCount", count: 2 },
      { type: "goTo", step: 2 },
      { type: "setField", field: "parentName", value: "Carolina Vásquez" },
      { type: "setField", field: "bank", value: "Produbanco" },
      { type: "setConsent", value: true },
    );
    const id = first.result.current.state.students[0]?.id ?? 0;
    send(first.result.current.dispatch, { type: "updateStudent", id, field: "givenNames", value: "Mateo" });
    expect(sessionStorage.getItem(draftKey(musical.slug))).toBeNull();
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS));
    expect(sessionStorage.getItem(draftKey(musical.slug))).not.toBeNull();
    first.unmount();

    const second = renderHook(() => useHarness());
    const state: PayState = second.result.current.state;
    expect(state.step).toBe(2);
    expect(state.count).toBe(2);
    expect(state.students[0]?.givenNames).toBe("Mateo");
    expect(state.fields).toMatchObject({ parentName: "Carolina Vásquez", bank: "Produbanco", consent: true });
  });

  it("flushes immediately when the page is hidden", () => {
    const view = renderHook(() => useHarness());
    send(view.result.current.dispatch, { type: "setField", field: "phone", value: "0991234567" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    expect(loadDraft(musical.slug)?.fields.phone).toBe("0991234567");
  });

  it("does not save drafts for closed collections or on the success screen", () => {
    const view = renderHook(() => useHarness(false));
    send(view.result.current.dispatch, { type: "setField", field: "phone", value: "0991234567" });
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2));
    expect(sessionStorage.getItem(draftKey(musical.slug))).toBeNull();
  });

  it("ignores malformed drafts", () => {
    sessionStorage.setItem(draftKey(musical.slug), JSON.stringify({ v: 1, step: 9 }));
    expect(loadDraft(musical.slug)).toBeNull();
  });
});
