import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPayment } from "../../shared/api";
import { navigate } from "../lib/router";
import { App } from "./App";
import { json, makeCollection, makePayment, mockApi, type Call } from "./test/fixtures";

const collection = makeCollection({
  stats: { payments: 3, students: 3, enRevision: 2, recibido: 1, observado: 0, pagado: 0, paidCents: 0, expectedCents: 4200 },
});

function payments(): AdminPayment[] {
  return [
    makePayment({ id: "p1", code: "AAA-111", parentName: "Carolina Vásquez", students: [{ givenNames: "Mateo", surnames: "Andrade", option: "hombre", optionLabel: "Vestuario de hombre" }] }),
    makePayment({ id: "p2", code: "BBB-222", parentName: "Jorge Ruiz", students: [{ givenNames: "Valentina", surnames: "Ruiz", option: "mujer", optionLabel: "Vestuario de mujer" }] }),
    makePayment({ id: "p3", code: "CCC-333", status: "recibido", parentName: "Daniela Ortiz", students: [{ givenNames: "Thiago", surnames: "Jaramillo", option: "hombre", optionLabel: "Vestuario de hombre" }] }),
  ];
}

function signedInApi(overrides: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  return mockApi({
    "GET /api/admin/session": () => json(200, { ok: true }),
    "GET /api/admin/collections": () => json(200, { collections: [collection] }),
    "GET /api/admin/payments": () => json(200, { payments: payments() }),
    "POST /api/admin/logout": () => json(200, { ok: true }),
    ...overrides,
  });
}

function openAt(hash: string): void {
  window.history.replaceState(null, "", `/admin${hash}`);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  openAt("");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session", () => {
  it("shows the login, signs in and lands on the summary", async () => {
    let signedIn = false;
    const api = mockApi({
      "GET /api/admin/session": () => (signedIn ? json(200, { ok: true }) : json(401, { error: "unauthorized", message: "Tu sesión expiró." })),
      "POST /api/admin/login": (call) => {
        const body = call.body;
        const ok = typeof body === "object" && body !== null && "password" in body && body.password === "secreta";
        if (!ok) return json(401, { error: "invalid_password", message: "Contraseña incorrecta." });
        signedIn = true;
        return json(200, { ok: true });
      },
      "GET /api/admin/collections": () => json(200, { collections: [collection] }),
      "GET /api/admin/payments": () => json(200, { payments: payments() }),
    });
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);

    const password = await screen.findByLabelText("Contraseña");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Escribe la contraseña.")).toBeInTheDocument();

    await user.type(password, "mala");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Contraseña incorrecta.")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Mostrar contraseña" }));
    expect(password).toHaveAttribute("type", "text");

    await user.clear(password);
    await user.type(password, "secreta{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Resumen" })).toBeInTheDocument();
    expect(await screen.findByText("Mateo Andrade")).toBeInTheDocument();
  });

  it("explains the rate limit", async () => {
    const api = mockApi({
      "GET /api/admin/session": () => json(401, { error: "unauthorized", message: "x" }),
      "POST /api/admin/login": () => json(429, { error: "rate_limited", message: "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar." }),
    });
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Contraseña"), "x{Enter}");
    expect(await screen.findByText(/Demasiados intentos/)).toBeInTheDocument();
  });

  it("shows a setup notice when the server has no admin password", async () => {
    vi.stubGlobal("fetch", mockApi({ "GET /api/admin/session": () => json(503, { error: "admin_disabled", message: "El acceso de administración no está configurado." }) }).fetch);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Falta configurar el acceso" })).toBeInTheDocument();
    expect(screen.getByText("ADMIN_PASSWORD")).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });

  it("returns to the login with a notice when any request answers 401", async () => {
    const api = signedInApi({ "GET /api/admin/collections": () => json(401, { error: "unauthorized", message: "Tu sesión expiró. Ingresa de nuevo." }) });
    vi.stubGlobal("fetch", api.fetch);
    render(<App />);
    expect(await screen.findByText("Tu sesión expiró. Ingresa de nuevo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });

  it("signs out", async () => {
    const api = signedInApi();
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByLabelText("Contraseña")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST" && c.url === "/api/admin/logout")).toBe(true);
  });
});

describe("payments list", () => {
  it("filters by status with counts and searches by student, representative or code", async () => {
    openAt("#pagos");
    vi.stubGlobal("fetch", signedInApi().fetch);
    const user = userEvent.setup();
    render(<App />);

    const filter = await screen.findByRole("radiogroup", { name: "Filtrar por estado" });
    await screen.findByText("Mateo Andrade");
    expect(within(filter).getByRole("radio", { name: "En revisión, 2" })).toHaveAttribute("aria-checked", "true");
    expect(within(filter).getByRole("radio", { name: "Todos, 3" })).toBeInTheDocument();
    expect(within(filter).getByRole("radio", { name: "Recibido, 1" })).toBeInTheDocument();
    expect(screen.queryByText("Thiago Jaramillo")).not.toBeInTheDocument();

    await user.click(within(filter).getByRole("radio", { name: "Recibido, 1" }));
    expect(window.location.hash).toBe("#pagos/recibido");
    expect(await screen.findByText("Thiago Jaramillo")).toBeInTheDocument();
    expect(screen.queryByText("Mateo Andrade")).not.toBeInTheDocument();

    await user.click(within(filter).getByRole("radio", { name: "Todos, 3" }));
    const search = screen.getByRole("searchbox", { name: "Buscar pagos" });
    await user.type(search, "ruiz");
    await waitFor(() => expect(screen.queryByText("Mateo Andrade")).not.toBeInTheDocument());
    expect(screen.getByText("Valentina Ruiz")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "ccc333");
    expect(await screen.findByText("Thiago Jaramillo")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "nadie");
    expect(await screen.findByText("No hay pagos con estos filtros")).toBeInTheDocument();
  });
});

describe("verify payment", () => {
  it("requires a note to observe, rolls back when the server fails, then moves to the next payment", async () => {
    openAt("#pago/p1");
    let fail = true;
    const api = signedInApi({
      "POST /api/admin/payments/p1/status": () =>
        fail ? json(500, { error: "server_error", message: "Tuvimos un problema en el servidor." }) : json(200, { ok: true, status: "observado" }),
    });
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Verificar pago" })).toBeInTheDocument();
    expect(await screen.findAllByText("AAA-111")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Observar…" }));
    await user.click(screen.getByRole("button", { name: "Guardar observación" }));
    expect(await screen.findByText("Escribe el motivo para que la familia sepa qué pasó.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Comprobante ilegible" }));
    expect(screen.getByLabelText(/Motivo para la familia/)).toHaveValue("No se puede leer el comprobante. Sube una captura de pantalla más clara.");
    await user.click(screen.getByRole("button", { name: "Guardar observación" }));
    expect((await screen.findAllByText("Tuvimos un problema en el servidor.")).length).toBeGreaterThan(0);
    // Rolled back: still in review.
    expect(screen.getAllByText("En revisión").length).toBeGreaterThan(0);
    expect(screen.queryByText("Con observación")).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Guardar observación" }));
    await waitFor(() => expect(window.location.hash).toBe("#pago/p2"));
    const post = api.calls.filter((c) => c.method === "POST" && c.url === "/api/admin/payments/p1/status").at(-1);
    expect(post?.body).toEqual({ status: "observado", note: "No se puede leer el comprobante. Sube una captura de pantalla más clara." });
    expect(await screen.findAllByText("BBB-222")).not.toHaveLength(0);
  });

  it("marks received optimistically without a note", async () => {
    openAt("#pago/p2");
    let release: (() => void) | null = null;
    const api = signedInApi({
      "POST /api/admin/payments/p2/status": () => new Promise<Response>((resolve) => {
        release = () => resolve(json(200, { ok: true, status: "recibido" }));
      }),
    });
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Comprobante recibido" }));
    expect(await screen.findAllByText("Recibido")).not.toHaveLength(0);
    await act(async () => release?.());
    await waitFor(() => expect(window.location.hash).toBe("#pago/p1"));
    expect(api.calls.find((c) => c.url === "/api/admin/payments/p2/status")?.body).toEqual({ status: "recibido" });
  });
});

describe("unsaved changes guard", () => {
  it("keeps the editor open with an inline notice until changes are discarded", async () => {
    openAt("#evento/nuevo");
    vi.stubGlobal("fetch", signedInApi().fetch);
    const user = userEvent.setup();
    render(<App />);

    const title = await screen.findByLabelText("Título");
    await user.type(title, "Paseo al Cotopaxi");
    expect(screen.getByLabelText("Enlace")).toHaveValue("paseo-al-cotopaxi");

    act(() => navigate("#eventos"));
    expect(await screen.findByText("Tienes cambios sin guardar")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Paseo al Cotopaxi");
    await waitFor(() => expect(window.location.hash).toBe("#evento/nuevo"));

    await user.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.queryByText("Tienes cambios sin guardar")).not.toBeInTheDocument();

    act(() => navigate("#eventos"));
    await user.click(await screen.findByRole("button", { name: "Descartar cambios" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Eventos" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#eventos");
  });

  it("leaves without asking when nothing changed, and shows validation errors on save", async () => {
    openAt("#evento/nuevo");
    const api = signedInApi();
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Escribe un título de 3 a 80 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("Elige la fecha límite.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    act(() => navigate("#eventos"));
    expect(await screen.findByRole("heading", { level: 1, name: "Eventos" })).toBeInTheDocument();
  });

  it("creates a collection and shows a taken slug next to the field", async () => {
    openAt("#evento/nuevo");
    let taken = true;
    const api = signedInApi({
      "POST /api/admin/collections": () =>
        taken
          ? json(409, { error: "slug_taken", message: "Ya existe una recaudación con ese enlace. Elige otro." })
          : json(200, { ok: true, collection: makeCollection({ id: "c2", slug: "paseo-cotopaxi", title: "Paseo al Cotopaxi" }) }),
    });
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Título"), "Paseo al Cotopaxi");
    await user.type(screen.getByLabelText("Descripción"), "Salida en bus con almuerzo.");
    await user.type(screen.getByLabelText("Nombre"), "Estudiante");
    await user.type(screen.getByLabelText("Precio"), "28,5");
    await user.type(screen.getByLabelText("Fecha límite"), "2027-01-23");
    await user.type(screen.getByLabelText("Link de cobro de Deuna"), "https://pagar.deuna.app/H92p/abc+/def==");
    await user.type(screen.getByLabelText("Válido hasta"), "2026-12-26");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Ya existe una recaudación con ese enlace. Elige otro.", { selector: "span" })).toBeInTheDocument();

    taken = false;
    await user.clear(screen.getByLabelText("Enlace"));
    await user.type(screen.getByLabelText("Enlace"), "paseo-cotopaxi");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Eventos" })).toBeInTheDocument();
    const create = api.calls.filter((c) => c.url === "/api/admin/collections" && c.method === "POST").at(-1);
    expect(create?.body).toMatchObject({
      title: "Paseo al Cotopaxi",
      slug: "paseo-cotopaxi",
      options: [{ key: "estudiante", label: "Estudiante", detail: null, cents: 2850 }],
      deadline: "2027-01-23",
      status: "abierta",
      tone: "#C81E3A",
      deunaLink: "https://pagar.deuna.app/H92p/abc+/def==",
      deunaLinkExpires: "2026-12-26",
    });
  });

  it("switches to edit mode as soon as the collection is created, even if the cover upload gets a 401", async () => {
    openAt("#evento/nuevo");
    const created = makeCollection({ id: "c2", slug: "paseo-cotopaxi", title: "Paseo al Cotopaxi" });
    const api = signedInApi({
      "POST /api/admin/collections": () => json(200, { ok: true, collection: created }),
      "POST /api/admin/collections/c2/cover": () => json(401, { error: "unauthorized", message: "Tu sesión expiró. Ingresa de nuevo." }),
    });
    vi.stubGlobal("fetch", api.fetch);
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.type(await screen.findByLabelText("Título"), "Paseo al Cotopaxi");
    await user.type(screen.getByLabelText("Descripción"), "Salida en bus con almuerzo.");
    await user.type(screen.getByLabelText("Nombre"), "Estudiante");
    await user.type(screen.getByLabelText("Precio"), "28,5");
    await user.type(screen.getByLabelText("Fecha límite"), "2027-01-23");
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "portada.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(api.calls.some((c) => c.url === "/api/admin/collections/c2/cover")).toBe(true));
    // The hash already points at the created collection, so the next save updates instead of re-creating (slug_taken).
    await waitFor(() => expect(window.location.hash).toBe("#evento/c2"));
    const order = api.calls.map((c) => `${c.method} ${c.url}`);
    expect(order.indexOf("POST /api/admin/collections")).toBeLessThan(order.indexOf("POST /api/admin/collections/c2/cover"));
    expect(api.calls.filter((c) => c.method === "POST" && c.url === "/api/admin/collections")).toHaveLength(1);
  });
});
