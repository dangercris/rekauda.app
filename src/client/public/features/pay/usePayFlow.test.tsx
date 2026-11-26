import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayEc } from "../../../lib/format";
import { CODES_KEY, readCodes } from "../../lib/codes";
import { created, json, musical, pngFile } from "../../test/fixtures";
import { usePayFlow } from "./usePayFlow";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePayFlow submission", () => {
  it("does not abort an in-flight submission on unmount and still saves the code", async () => {
    let release: (() => void) | undefined;
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      signal = init?.signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return json(201, created("ZZZ-999"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      usePayFlow({ collection: musical, form: { banks: ["Produbanco"], earliestTransferDate: "2000-01-01", earliestTransferLabel: "enero de 2000" }, enabled: true }),
    );
    const id = result.current.state.students[0]?.id ?? 1;
    act(() => {
      result.current.dispatch({ type: "updateStudent", id, field: "givenNames", value: "Mateo" });
      result.current.dispatch({ type: "updateStudent", id, field: "surnames", value: "Andrade" });
      result.current.dispatch({ type: "updateStudent", id, field: "option", value: "mujer" });
      result.current.dispatch({ type: "setField", field: "bank", value: "Produbanco" });
      result.current.dispatch({ type: "setField", field: "parentName", value: "Carolina Vasquez" });
      result.current.dispatch({ type: "setField", field: "phone", value: "0991234567" });
      result.current.dispatch({ type: "setField", field: "transferDate", value: todayEc() });
      result.current.dispatch({ type: "setConsent", value: true });
      result.current.dispatch({ type: "receiptReady", file: pngFile() });
    });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.submit();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    unmount();
    expect(signal?.aborted).toBe(false);

    release?.();
    await pending;
    await waitFor(() => expect(readCodes()).toEqual(["ZZZ-999"]));
    expect(localStorage.getItem(CODES_KEY)).toContain("ZZZ-999");
  });
});
