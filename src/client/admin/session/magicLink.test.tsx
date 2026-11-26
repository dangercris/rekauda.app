import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantA, tenantB } from "../../test/tenants";
import { App } from "../App";
import { forgetLinkToken } from "./linkLogin";
import { json, makeCollection, mockApi } from "../test/fixtures";

const TOKEN = "A".repeat(43);
const GENERIC = /Si el correo está registrado, te enviamos un enlace/;

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  forgetLinkToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

function stub(handlers: Record<string, () => Response> = {}) {
  const api = mockApi({
    "GET /api/config": () => json(200, tenantB),
    "GET /api/admin/session": () => json(401, { error: "unauthorized", message: "No autorizado." }),
    "POST /api/admin/magic-link": () => json(200, { ok: true }),
    "GET /api/admin/collections": () => json(200, { collections: [makeCollection()] }),
    "GET /api/admin/payments": () => json(200, { payments: [] }),
    "GET /api/admin/movements": () => json(200, { movements: [] }),
    ...handlers,
  });
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

describe("magic link request form", () => {
  it("asks for an email, not a password, in magic_link mode", async () => {
    stub();
    render(<App />);
    expect(await screen.findByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
    expect(screen.queryByText(/Pronto podrás/)).toBeNull();
  });

  it("posts the address and shows the same generic confirmation whatever the account state", async () => {
    const api = stub();
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "madre@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
    expect(api.calls.find((c) => c.url === "/api/admin/magic-link")?.body).toEqual({ email: "madre@example.test" });
  });

  it("lets the user go back and try another address after sending", async () => {
    stub();
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "madre@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
    await userEvent.click(await screen.findByRole("button", { name: "Usar otro correo" }));
    expect(await screen.findByLabelText("Correo electrónico")).toBeInTheDocument();
  });

  it("asks for an address before calling the server", async () => {
    const api = stub();
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Enviar enlace" }));
    expect(await screen.findByText("Escribe tu correo.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.url === "/api/admin/magic-link")).toBe(false);
  });

  it("shows the server's message for a malformed address and for rate limiting", async () => {
    let status = 400;
    stub({ "POST /api/admin/magic-link": () => json(status, { error: "x", message: status === 400 ? "Escribe un correo válido." : "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar." }) });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "mal");
    await userEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
    expect(await screen.findByText("Escribe un correo válido.")).toBeInTheDocument();
    status = 429;
    await userEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
    expect(await screen.findByText(/Demasiados intentos seguidos/)).toBeInTheDocument();
  });

  it("keeps the password form for password tenants", async () => {
    stub({ "GET /api/config": () => json(200, tenantA) });
    render(<App />);
    expect(await screen.findByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).toBeNull();
  });
});

const VERIFY = "/api/admin/magic-link/verify";
const verifyCalls = (api: ReturnType<typeof stub>) => api.calls.filter((c) => c.url === VERIFY);

describe("opening the emailed link", () => {
  const enter = () => screen.findByRole("button", { name: `Ingresar a ${tenantB.classShortName}` });

  it("scrubs the fragment and asks for a click: nothing is posted before it", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const api = stub({ [`POST ${VERIFY}`]: () => json(200, { ok: true }) });
    window.location.hash = `#acceso=${TOKEN}`;
    render(<App />);
    await enter();
    expect(window.location.hash).toBe("");
    expect(String(replace.mock.calls[0]?.[2])).not.toContain(TOKEN);
    expect(verifyCalls(api)).toEqual([]);
    expect(screen.queryByLabelText("Correo electrónico")).toBeNull();
  });

  it("posts the token once after the click and signs in", async () => {
    const api = stub({ [`POST ${VERIFY}`]: () => json(200, { ok: true }) });
    window.location.hash = `#acceso=${TOKEN}`;
    render(<App />);
    await userEvent.click(await enter());
    expect(await screen.findByText(/Tesorería · /)).toBeInTheDocument();
    expect(verifyCalls(api)).toEqual([{ method: "POST", url: VERIFY, body: { token: TOKEN } }]);
    expect(api.calls.filter((c) => c.url.includes(TOKEN))).toEqual([]);
  });

  it("shows the course name as plain text, not markup", async () => {
    stub({ "GET /api/config": () => json(200, { ...tenantB, classShortName: "<b>x</b>" }) });
    window.location.hash = `#acceso=${TOKEN}`;
    render(<App />);
    expect(await screen.findByRole("button", { name: "Ingresar a <b>x</b>" })).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("survives StrictMode: still one confirm step and one POST", async () => {
    const api = stub({ [`POST ${VERIFY}`]: () => json(200, { ok: true }) });
    window.location.hash = `#acceso=${TOKEN}`;
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await userEvent.click(await enter());
    await screen.findByText(/Tesorería · /);
    expect(verifyCalls(api)).toHaveLength(1);
  });

  it("explains an expired or used link after the click and offers the form for a new one", async () => {
    stub({ [`POST ${VERIFY}`]: () => json(401, { error: "invalid_link", message: "El enlace no es válido o ya fue usado. Pide uno nuevo." }) });
    window.location.hash = `#acceso=${TOKEN}`;
    render(<App />);
    await userEvent.click(await enter());
    expect(await screen.findByText("El enlace no es válido o ya fue usado. Pide uno nuevo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
  });

  it("ignores a fragment that cannot be a token", async () => {
    const api = stub();
    window.location.hash = "#acceso=corto";
    render(<App />);
    await screen.findByLabelText("Correo electrónico");
    expect(verifyCalls(api)).toEqual([]);
  });
});
