import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSavedStatuses } from "../features/status/useLookup";
import { json, lookupFor, mockFetch } from "../test/fixtures";
import { CODES_KEY, LEGACY_CODES_KEY, MAX_SAVED_CODES, readCodes, saveCode } from "./codes";
import { fetchLookup, isFresh, isRateLimited, LOOKUP_FRESH_MS, resetLookupStore } from "./lookupStore";

beforeEach(() => {
  localStorage.clear();
  resetLookupStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saved codes", () => {
  it("reads the legacy key when the new one is missing and migrates on save", () => {
    localStorage.setItem(LEGACY_CODES_KEY, JSON.stringify(["AAA-222", "bbb-333", 42, "nope"]));
    expect(readCodes()).toEqual(["AAA-222", "BBB-333"]);
    saveCode("CCC-444");
    expect(JSON.parse(localStorage.getItem(CODES_KEY) ?? "[]")).toEqual(["CCC-444", "AAA-222", "BBB-333"]);
  });

  it("prefers the new key, keeps newest first, deduplicates and caps at 12", () => {
    localStorage.setItem(LEGACY_CODES_KEY, JSON.stringify(["OLD-111"]));
    localStorage.setItem(CODES_KEY, JSON.stringify(["AAA-222"]));
    expect(readCodes()).toEqual(["AAA-222"]);
    for (let i = 0; i < 15; i += 1) saveCode(`C${String(i).padStart(2, "0")}-XYZ`);
    saveCode("C14-XYZ");
    const codes = readCodes();
    expect(codes).toHaveLength(MAX_SAVED_CODES);
    expect(codes[0]).toBe("C14-XYZ");
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem(CODES_KEY, "{not json");
    expect(readCodes()).toEqual([]);
  });
});

describe("lookup cache", () => {
  it("caches results for 60 s", async () => {
    mockFetch({ "GET /api/lookup/ABC-234": () => json(200, lookupFor("ABC-234")) });
    await fetchLookup("abc234");
    expect(isFresh("ABC-234")).toBe(true);
    expect(isFresh("ABC-234", Date.now() + LOOKUP_FRESH_MS + 1)).toBe(false);
  });

  it("pauses background refreshes after a 429", async () => {
    mockFetch({ "GET /api/lookup/*": () => json(429, { error: "rate_limited", message: "Demasiados intentos." }) });
    await expect(fetchLookup("ABC-234")).rejects.toMatchObject({ status: 429 });
    expect(isRateLimited()).toBe(true);
  });
});

function Saved({ codes, active }: { codes: string[]; active: boolean }) {
  const statuses = useSavedStatuses(codes, active);
  return (
    <ul>
      {codes.map((code) => (
        <li key={code} data-testid={code}>
          {statuses[code]?.status === "ok" ? `ok:${statuses[code].data.status}` : statuses[code]?.status === "error" ? `error:${statuses[code].message}` : "loading"}
        </li>
      ))}
    </ul>
  );
}

describe("saved statuses", () => {
  it("stops fetching at the first 429 and does not refetch fresh codes", async () => {
    const fetchMock = mockFetch({
      "GET /api/lookup/AAA-222": () => json(200, lookupFor("AAA-222", { status: "pagado" })),
      "GET /api/lookup/BBB-333": () => json(429, { error: "rate_limited", message: "Demasiados intentos." }),
      "GET /api/lookup/CCC-444": () => json(200, lookupFor("CCC-444")),
    });
    const codes = ["AAA-222", "BBB-333", "CCC-444"];
    const view = render(<Saved codes={codes} active />);
    await waitFor(() => expect(screen.getByTestId("BBB-333")).toHaveTextContent("error"));
    expect(screen.getByTestId("AAA-222")).toHaveTextContent("ok:pagado");
    expect(screen.getByTestId("CCC-444")).toHaveTextContent("error:No se pudo consultar");
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls).toEqual(["/api/lookup/AAA-222", "/api/lookup/BBB-333"]);

    // Becoming active again while rate limited: nothing is fetched.
    view.rerender(<Saved codes={codes} active={false} />);
    view.rerender(<Saved codes={codes} active />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes only stale codes", async () => {
    const fetchMock = mockFetch({ "GET /api/lookup/*": ({ url }) => json(200, lookupFor(url.split("/").pop() ?? "")) });
    await fetchLookup("AAA-222");
    fetchMock.mockClear();
    render(<Saved codes={["AAA-222", "BBB-333"]} active />);
    await waitFor(() => expect(screen.getByTestId("BBB-333")).toHaveTextContent("ok:en_revision"));
    expect(screen.getByTestId("AAA-222")).toHaveTextContent("ok:en_revision");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/lookup/BBB-333"]);
  });
});
