import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantA, tenantB } from "../test/tenants";
import { App } from "./App";
import { json, makeCollection, mockApi } from "./test/fixtures";
import type { ConfigResponse } from "../../shared/api";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

beforeEach(() => {
  window.location.hash = "";
});

function stub(config: ConfigResponse, signedIn: boolean) {
  const api = mockApi({
    "GET /api/config": () => json(200, config),
    "GET /api/admin/session": () => (signedIn ? json(200, { ok: true }) : json(401, { error: "unauthorized", message: "No autorizado." })),
    "GET /api/admin/collections": () => json(200, { collections: [makeCollection()] }),
    "GET /api/admin/payments": () => json(200, { payments: [] }),
    "GET /api/admin/movements": () => json(200, { movements: [] }),
  });
  vi.stubGlobal("fetch", api.fetch);
}

describe.each([
  ["tenant A", tenantA],
  ["tenant B", tenantB],
])("admin app for %s", (_name, config) => {
  it("shows the tenant's mark and class on the login", async () => {
    stub(config, false);
    render(<App />);
    expect(await screen.findByText(config.classMark)).toBeInTheDocument();
    expect(screen.getByText(config.classShortName)).toBeInTheDocument();
  });

  it("shows the tenant's mark, class and eyebrow in the signed-in shell", async () => {
    stub(config, true);
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(config.classMark).length).toBeGreaterThan(0));
    expect(screen.getAllByText(config.classShortName).length).toBeGreaterThan(0);
    expect(await screen.findByText(`Tesorería · ${config.classShortName}`)).toBeInTheDocument();
  });
});

describe("admin app config failures", () => {
  it("renders the error state instead of the app when the config cannot load", async () => {
    vi.stubGlobal("fetch", mockApi({ "GET /api/config": () => json(500, { error: "x", message: "Error." }) }).fetch);
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar la configuración");
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });
});
