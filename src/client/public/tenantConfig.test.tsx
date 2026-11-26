import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigResponse } from "../../shared/api";
import { tenantA, tenantB } from "../test/tenants";
import { App } from "./App";
import { resetLookupStore } from "./lib/lookupStore";
import { footerText } from "./lib/identity";
import { baseRoutes, json, mockFetch, musical, setLocation } from "./test/fixtures";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLookupStore();
});

afterEach(() => {
  document.title = "";
  vi.unstubAllGlobals();
  setLocation("/");
});

async function openPay(config: ConfigResponse) {
  mockFetch(baseRoutes([musical], { "GET /api/config": () => json(200, config) }));
  setLocation("/r/vestuario-musical");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "Transfiere el valor" });
  return user;
}

describe.each([
  ["tenant A", tenantA],
  ["tenant B", tenantB],
])("public app for %s", (_name, config) => {
  it("shows the tenant's names in the header, footer and document title", async () => {
    await openPay(config);
    expect(screen.getByText(footerText(config.className, config.schoolName))).toBeInTheDocument();
    expect(screen.getAllByText(config.className).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.title).toBe(`Vestuario del musical · ${config.classShortName}`));
  });

  it("shows the tenant's bank account in the transfer step", async () => {
    await openPay(config);
    expect(screen.getByText(config.treasury.accountNumber)).toBeInTheDocument();
    expect(screen.getByText(config.treasury.holder)).toBeInTheDocument();
    expect(screen.getByText(config.treasury.holderId)).toBeInTheDocument();
  });

  it("offers the tenant's banks in the registration step", async () => {
    const user = await openPay(config);
    await user.click(screen.getByRole("button", { name: "Agregar un estudiante" }));
    await user.click(screen.getByRole("button", { name: /Ya transferí, registrar pago/ }));
    const select = await screen.findByLabelText("Desde qué banco");
    const names = within(select).getAllByRole("option").map((o) => o.textContent);
    for (const bank of config.banks) expect(names).toContain(bank);
    for (const other of [...tenantA.banks, ...tenantB.banks].filter((b) => !config.banks.includes(b))) expect(names).not.toContain(other);
  });
});

describe("analytics follows the tenant's id", () => {
  it("offers cookie preferences only when the tenant has a Measurement ID", async () => {
    await openPay(tenantA);
    expect(screen.getByRole("button", { name: "Preferencias de cookies" })).toBeInTheDocument();
  });

  it("hides cookie preferences for a tenant without an id", async () => {
    await openPay(tenantB);
    expect(screen.queryByRole("button", { name: "Preferencias de cookies" })).toBeNull();
  });
});

describe("home page", () => {
  it("titles the document with the tenant's short class name", async () => {
    mockFetch(baseRoutes([musical, { ...musical, slug: "viaje-fin-de-ano" }], { "GET /api/config": () => json(200, tenantB) }));
    setLocation("/");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Recaudaciones del curso" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Recaudaciones 3.º Bach. C"));
  });
});
