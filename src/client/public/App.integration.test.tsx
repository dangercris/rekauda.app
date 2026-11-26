import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { CODES_KEY } from "./lib/codes";
import { resetLookupStore } from "./lib/lookupStore";
import { baseRoutes, created, json, lookupFor, mockFetch, musical, pngFile, setLocation, trip } from "./test/fixtures";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetLookupStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocation("/");
});

describe("pay flow, end to end with a mocked API", () => {
  it("transfers, registers two students, shows the code and looks it up", async () => {
    let sent: FormData | null = null;
    const fetchMock = mockFetch(
      baseRoutes([musical, trip], {
        "POST /api/payments": ({ body }) => {
          sent = body instanceof FormData ? body : null;
          return json(201, created("ABC-234"));
        },
        "GET /api/lookup/ABC-234": () =>
          json(
            200,
            lookupFor("ABC-234", {
              students: [
                { name: "Mateo A.", option: "mujer", optionLabel: "Vestuario de mujer" },
                { name: "Ana P.", option: "hombre", optionLabel: "Vestuario de hombre" },
              ],
            }),
          ),
      }),
    );
    setLocation("/r/vestuario-musical");
    const user = userEvent.setup();
    const { container } = render(<App />);

    // Step 1
    expect(await screen.findByRole("heading", { name: "Transfiere el valor" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Agregar un estudiante" }));
    expect(await screen.findByText("Total a transferir")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Copiar monto/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ya transferí, registrar pago/ }));

    // Step 2: two blocks synced from the counter, amount auto-filled.
    expect(await screen.findByRole("heading", { name: "Registra tu pago" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Registra tu pago" })).toHaveFocus());
    const given = screen.getAllByLabelText("Nombres");
    const surnames = screen.getAllByLabelText("Apellidos");
    expect(given).toHaveLength(2);
    expect(screen.getByLabelText("Monto transferido")).toHaveValue("28,00");

    // Submitting empty shows the summary and focuses the first problem.
    await user.click(screen.getByRole("button", { name: /Registrar pago · \$28,00/ }));
    expect(await screen.findByText(/Revisa \d+ campos marcados/)).toBeInTheDocument();
    await waitFor(() => expect(given[0]).toHaveFocus());

    await user.type(given[0]!, "Mateo José");
    await user.type(surnames[0]!, "Andrade Vásquez");
    await user.type(given[1]!, "Ana");
    await user.type(surnames[1]!, "Pérez");
    const groups = screen.getAllByRole("group", { name: /Estudiante \d/ });
    await user.click(within(groups[0]!).getByRole("radio", { name: /Vestuario de mujer/ }));
    await user.click(within(groups[1]!).getByRole("radio", { name: /Vestuario de hombre/ }));

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    await user.upload(fileInput!, pngFile());
    expect(await screen.findByText("Listo para enviar")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Desde qué banco"), "Produbanco");
    await user.type(screen.getByLabelText("Nombre y apellido"), "Carolina Vásquez");
    await user.type(screen.getByLabelText("Celular"), "099 123 4567");
    await user.click(screen.getByLabelText(/Autorizo usar estos datos/));

    await user.click(screen.getByRole("button", { name: /Registrar pago · \$28,00/ }));

    // Step 3
    expect(await screen.findByRole("heading", { name: "Pago registrado" })).toBeInTheDocument();
    expect(screen.getAllByText("ABC-234").length).toBeGreaterThan(0);
    expect(screen.getByText("Mateo Andrade")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();

    const form = sent as FormData | null;
    expect(form).not.toBeNull();
    expect(form?.get("collection")).toBe("vestuario-musical");
    expect(form?.get("amount")).toBe("28.00");
    expect(form?.get("hp_c9x")).toBe("");
    expect(form?.get("consent")).toBe("si");
    expect(form?.get("bank")).toBe("Produbanco");
    expect(JSON.parse(String(form?.get("students")))).toEqual([
      { givenNames: "Mateo José", surnames: "Andrade Vásquez", option: "mujer" },
      { givenNames: "Ana", surnames: "Pérez", option: "hombre" },
    ]);
    expect(form?.get("receipt")).toBeInstanceOf(File);
    expect(JSON.parse(localStorage.getItem(CODES_KEY) ?? "[]")).toEqual(["ABC-234"]);
    expect(sessionStorage.getItem("draft:vestuario-musical")).toBeNull();

    // "Ver estado de mi pago" switches to #estado and looks the code up.
    await user.click(screen.getByRole("button", { name: "Ver estado de mi pago" }));
    await waitFor(() => expect(window.location.hash).toBe("#estado"));
    expect(await screen.findByRole("textbox", { name: "Código de seguimiento" })).toHaveValue("ABC-234");
    expect(await screen.findByText("Revisando tu comprobante")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/lookup/ABC-234")).toBe(true);

    // "Registrar otro pago" keeps the representative but clears the rest.
    await user.click(screen.getAllByRole("link", { name: "Pagar" })[0]!);
    await user.click(await screen.findByRole("button", { name: "Registrar otro pago" }));
    await user.click(await screen.findByRole("button", { name: /Ya transferí, registrar pago/ }));
    expect(await screen.findByLabelText("Nombre y apellido")).toHaveValue("Carolina Vásquez");
    expect(screen.getByLabelText("Celular")).toHaveValue("099 123 4567");
    expect(screen.getByLabelText("Desde qué banco")).toHaveValue("Produbanco");
    expect(screen.getAllByLabelText("Nombres")).toHaveLength(1);
    expect(screen.getByLabelText(/Autorizo usar estos datos/)).not.toBeChecked();
  });

  it("shows server errors in a notice and keeps the form", async () => {
    mockFetch(
      baseRoutes([trip], {
        "POST /api/payments": () => json(409, { error: "collection_closed", message: "Esta recaudación ya está cerrada." }),
      }),
    );
    setLocation("/r/viaje-fin-de-ano");
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole("button", { name: /Ya transferí, registrar pago/ }));
    await user.type(await screen.findByLabelText("Nombres"), "Mateo");
    await user.type(screen.getByLabelText("Apellidos"), "Andrade");
    expect(screen.getByText("Elige la opción de cada estudiante para calcular el total.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Acompañante/ }));
    expect(screen.getByLabelText("Monto transferido")).toHaveValue("35,00");
    await user.clear(screen.getByLabelText("Monto transferido"));
    await user.type(screen.getByLabelText("Monto transferido"), "30");
    expect(screen.getByText(/El total esperado es \$35,00/)).toBeInTheDocument();
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, pngFile());
    await user.selectOptions(screen.getByLabelText("Desde qué banco"), "Produbanco");
    await user.type(screen.getByLabelText("Nombre y apellido"), "Carolina Vásquez");
    await user.type(screen.getByLabelText("Celular"), "0991234567");
    await user.click(screen.getByLabelText(/Autorizo usar estos datos/));
    await user.click(screen.getByRole("button", { name: /Registrar pago · \$30,00/ }));
    expect(await screen.findByText("Esta recaudación ya está cerrada.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombres")).toHaveValue("Mateo");
  });
});
