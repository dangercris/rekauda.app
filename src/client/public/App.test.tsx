import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { CODES_KEY } from "./lib/codes";
import { resetLookupStore } from "./lib/lookupStore";
import { baseRoutes, closed, gift, json, lookupFor, mockFetch, musical, setLocation, trip } from "./test/fixtures";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLookupStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocation("/");
});

const heading = (name: RegExp | string) => screen.findByRole("heading", { name, level: 1 });

describe("routing", () => {
  it("opens the only open collection in place on / (URL path unchanged)", async () => {
    mockFetch(baseRoutes([musical, closed]));
    setLocation("/");
    render(<App />);
    expect(await heading("Vestuario del musical")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    await waitFor(() => expect(window.location.hash).toBe("#pagar"));
    expect(document.title).toBe("Vestuario del musical · 1.º Básica A");
    // 2 public collections: the back link to the full list is shown.
    expect(screen.getAllByRole("link", { name: /Todas las recaudaciones/ })[0]).toHaveAttribute("href", "/?todas");
  });

  it("shows the home list on /?todas and with several open collections", async () => {
    mockFetch(baseRoutes([musical, trip, closed]));
    setLocation("/?todas");
    render(<App />);
    expect(await heading("Recaudaciones del curso")).toBeInTheDocument();
    expect(document.title).toBe("Recaudaciones 1.º Básica A");
    const openList = screen.getByRole("list", { name: "Recaudaciones abiertas" });
    expect(within(openList).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Anteriores" })).toBeInTheDocument();
    expect(within(openList).getByRole("link", { name: /Viaje de fin de año/ })).toHaveAttribute("href", "/r/viaje-fin-de-ano");
  });

  it("shows the empty state when nothing is open", async () => {
    mockFetch(baseRoutes([closed]));
    setLocation("/");
    render(<App />);
    expect(await screen.findByText("No hay recaudaciones activas en este momento.")).toBeInTheDocument();
  });

  it("hides the back link with a single collection", async () => {
    mockFetch(baseRoutes([gift]));
    setLocation("/r/regalo-de-graduacion");
    render(<App />);
    expect(await heading("Regalo de graduación")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("link", { name: /Todas las recaudaciones/ })).toBeNull());
  });

  it("closed collections hide Pagar and open Avance without saved codes", async () => {
    mockFetch(baseRoutes([closed, musical]));
    setLocation("/r/rifa-cerrada#pagar");
    render(<App />);
    expect(await heading("Rifa cerrada")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#avance"));
    expect(screen.queryByRole("link", { name: "Pagar" })).toBeNull();
    expect(screen.getAllByText("Esta recaudación está cerrada").length).toBeGreaterThan(0);
  });

  it("closed collections open Mi estado when this phone has saved codes", async () => {
    localStorage.setItem(CODES_KEY, JSON.stringify(["ABC-234"]));
    mockFetch(baseRoutes([closed], { "GET /api/lookup/ABC-234": () => json(200, lookupFor("ABC-234")) }));
    setLocation("/r/rifa-cerrada");
    render(<App />);
    expect(await heading("Rifa cerrada")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#estado"));
    expect(await screen.findByText("Registrados desde este celular")).toBeInTheDocument();
  });

  it("tab links push history so back/forward move between tabs", async () => {
    mockFetch(baseRoutes([musical, trip]));
    setLocation("/r/vestuario-musical");
    render(<App />);
    await heading("Vestuario del musical");
    const user = userEvent.setup();
    const [avance] = screen.getAllByRole("link", { name: "Avance" });
    await user.click(avance!);
    expect(window.location.hash).toBe("#avance");
    expect(await screen.findByRole("heading", { name: "Avance del curso" })).toBeVisible();
    window.history.back();
    await waitFor(() => expect(window.location.hash).toBe("#pagar"));
  });

  it("renders not-found for unknown slugs and paths", async () => {
    mockFetch(baseRoutes([musical]));
    setLocation("/r/no-existe");
    const view = render(<App />);
    expect(await screen.findByText("No encontramos esta recaudación")).toBeInTheDocument();
    view.unmount();
    setLocation("/otra/cosa");
    render(<App />);
    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
  });

  it("offers a retry on network errors", async () => {
    let fail = true;
    mockFetch({
      ...baseRoutes([musical]),
      "GET /api/collections/vestuario-musical": () => (fail ? Promise.reject(new TypeError("offline")) : json(200, musical)),
    });
    setLocation("/r/vestuario-musical");
    render(<App />);
    const retry = await screen.findByRole("button", { name: /Intentar de nuevo/ });
    fail = false;
    await userEvent.setup().click(retry);
    expect(await heading("Vestuario del musical")).toBeInTheDocument();
  });
});
