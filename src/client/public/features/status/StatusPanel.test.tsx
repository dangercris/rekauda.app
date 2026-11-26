import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLookupStore } from "../../lib/lookupStore";
import { json, lookupFor, mockFetch, musical } from "../../test/fixtures";
import { StatusPanel } from "./StatusPanel";

beforeEach(() => {
  localStorage.clear();
  resetLookupStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StatusPanel saved statuses", () => {
  it("fires exactly one lookup per stale code when the tab opens", async () => {
    const fetchMock = mockFetch({ "GET /api/lookup/*": ({ url }) => json(200, lookupFor(url.split("/").pop() ?? "")) });
    const codes = ["AAA-222", "BBB-333"];
    const props = { collection: musical, codes, request: null, onRegisterAgain: () => undefined };
    const view = render(<StatusPanel {...props} active={false} />);
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(<StatusPanel {...props} active />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock.mock.calls.map((c) => String(c[0])).sort()).toEqual(["/api/lookup/AAA-222", "/api/lookup/BBB-333"]);
    expect(screen.getByText("Estado de mi pago")).toBeInTheDocument();
  });
});
