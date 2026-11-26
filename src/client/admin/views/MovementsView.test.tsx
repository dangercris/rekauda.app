import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBankMovement, AdminPayment } from "../../../shared/api";
import { App } from "../App";
import { json, makeCollection, makeMovement, makePayment, mockApi } from "../test/fixtures";

const collection = makeCollection();

function api(options: { movements: AdminBankMovement[]; payments: AdminPayment[] }) {
  let movements = options.movements;
  return mockApi({
    "GET /api/admin/session": () => json(200, { ok: true }),
    "GET /api/admin/collections": () => json(200, { collections: [collection] }),
    "GET /api/admin/payments": () => json(200, { payments: options.payments }),
    "GET /api/admin/movements": () => json(200, { movements }),
    "POST /api/admin/movements/10000000-0000-4000-8000-0000000000aa/link": () => {
      movements = [];
      return json(200, { ok: true });
    },
    "POST /api/admin/movements/10000000-0000-4000-8000-0000000000aa/ignore": () => {
      movements = [];
      return json(200, { ok: true });
    },
  });
}

const movement = makeMovement({ id: "10000000-0000-4000-8000-0000000000aa", transactionNumber: "500000000001" });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin#movimientos");
});
afterEach(() => vi.unstubAllGlobals());

describe("movements view", () => {
  it("shows the unmatched movement with a tab badge and links it to the best payment", async () => {
    const target = makePayment({ id: "p-target", parentName: "Lucia Anais Torres", transferDate: "2026-11-26" });
    const other = makePayment({ id: "p-other", parentName: "Familia Castro", students: [{ givenNames: "Ana", surnames: "Castro", option: "mujer", optionLabel: "Vestuario de mujer" }] });
    const mock = api({ movements: [movement], payments: [other, target, makePayment({ amountCents: 2800 })] });
    vi.stubGlobal("fetch", mock.fetch);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Movimientos" })).toBeInTheDocument();
    expect(await screen.findByText("Torres Mendez Lucia Ana")).toBeInTheDocument();
    expect(screen.getByText("500000000001")).toBeInTheDocument();

    const select = await screen.findByRole("combobox", { name: "Vincular con el pago" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    const options = within(select).getAllByRole("option");
    expect(options[1]?.textContent).toContain("Lucia Anais Torres");
    expect(options[2]?.textContent).toContain("Familia Castro");

    const link = screen.getByRole("button", { name: "Vincular" });
    expect(link).toBeDisabled();
    await user.selectOptions(select, "p-target");
    await user.click(link);

    await waitFor(() =>
      expect(mock.calls.some((c) => c.method === "POST" && c.url.endsWith("/link") && JSON.stringify(c.body) === JSON.stringify({ paymentId: "p-target" }))).toBe(true),
    );
    expect(await screen.findByText("No hay movimientos por vincular")).toBeInTheDocument();
  });

  it("ignores a movement", async () => {
    const mock = api({ movements: [movement], payments: [] });
    vi.stubGlobal("fetch", mock.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Ignorar" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "POST" && c.url.endsWith("/ignore"))).toBe(true));
    expect(await screen.findByText("No hay movimientos por vincular")).toBeInTheDocument();
  });

  it("explains when no payment has the same amount", async () => {
    vi.stubGlobal("fetch", api({ movements: [movement], payments: [makePayment({ amountCents: 2800 })] }).fetch);
    render(<App />);
    expect(await screen.findByText(/No hay pagos por vincular con este monto/)).toBeInTheDocument();
  });
});

describe("Deuna confirmation badge", () => {
  it("shows transaction, payer, amount and time in the payments list", async () => {
    window.history.replaceState(null, "", "/admin#pagos/todos");
    const confirmed = makePayment({
      status: "recibido",
      bankMovement: {
        id: "m1",
        transactionNumber: "500000000001",
        amountCents: 1400,
        payerName: "Torres Mendez Lucia Ana",
        originBank: "Coop. Jep",
        receivedAt: "2026-11-26T14:02:00.000Z",
        matchStatus: "auto",
      },
    });
    vi.stubGlobal("fetch", api({ movements: [], payments: [confirmed] }).fetch);
    render(<App />);
    expect(await screen.findByText("Confirmado por Deuna")).toBeInTheDocument();
    expect(screen.getByText(/N\.º 500000000001 · Torres Mendez Lucia Ana · \$14,00 · 26 nov 2026 · 09:02/)).toBeInTheDocument();
  });

  it("shows the confirmation in the payment detail with an unlink action", async () => {
    const confirmed = makePayment({
      id: "p-confirmed",
      status: "recibido",
      bankMovement: {
        id: "10000000-0000-4000-8000-0000000000bb",
        transactionNumber: "500000000001",
        amountCents: 1400,
        payerName: "Torres Mendez Lucia Ana",
        originBank: "Coop. Jep",
        receivedAt: "2026-11-26T14:02:00.000Z",
        matchStatus: "auto",
      },
    });
    window.history.replaceState(null, "", "/admin#pago/p-confirmed");
    const mock = api({ movements: [], payments: [confirmed] });
    vi.stubGlobal("fetch", mock.fetch);
    render(<App />);
    expect(await screen.findByText("Confirmado por Deuna")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
  });

  it("explains that unlinking does not change the payment status", async () => {
    let linked = true;
    const movementSummary = {
      id: "10000000-0000-4000-8000-0000000000cc",
      transactionNumber: "500000000001",
      amountCents: 1400,
      payerName: "Torres Mendez Lucia Ana",
      originBank: "Coop. Jep",
      receivedAt: "2026-11-26T14:02:00.000Z",
      matchStatus: "auto" as const,
    };
    window.history.replaceState(null, "", "/admin#pago/p-unlink");
    const mock = mockApi({
      "GET /api/admin/session": () => json(200, { ok: true }),
      "GET /api/admin/collections": () => json(200, { collections: [collection] }),
      "GET /api/admin/payments": () => json(200, { payments: [makePayment({ id: "p-unlink", status: "recibido", bankMovement: linked ? movementSummary : null })] }),
      "GET /api/admin/movements": () => json(200, { movements: [] }),
      [`POST /api/admin/movements/${movementSummary.id}/unlink`]: () => {
        linked = false;
        return json(200, { ok: true });
      },
    });
    vi.stubGlobal("fetch", mock.fetch);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Desvincular" }));
    expect(await screen.findByText(/El estado del pago no cambió: revísalo si hace falta/)).toBeInTheDocument();
  });
});

describe("import Deuna .eml", () => {
  const eml = () => new File(["From: x"], "aviso.eml", { type: "message/rfc822" });

  async function importWith(response: unknown) {
    const mock = mockApi({
      "GET /api/admin/session": () => json(200, { ok: true }),
      "GET /api/admin/collections": () => json(200, { collections: [collection] }),
      "GET /api/admin/payments": () => json(200, { payments: [] }),
      "GET /api/admin/movements": () => json(200, { movements: [] }),
      "POST /api/admin/movements/import": () => json(200, response),
    });
    vi.stubGlobal("fetch", mock.fetch);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("En Gmail: abre el correo, menú ⋮, Descargar mensaje.")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("Archivo .eml del correo de Deuna"), eml());
    return mock;
  }

  it("shows a stored and linked result with the payment code and refreshes the lists", async () => {
    const mock = await importWith({ status: "stored", movementId: "m1", matched: true, paymentId: "p1", paymentCode: "ABC-123" });
    expect(await screen.findByText("Registrado y vinculado a ABC-123.")).toBeInTheDocument();
    await waitFor(() => expect(mock.calls.filter((c) => c.url.startsWith("/api/admin/movements") && c.method === "GET").length).toBeGreaterThan(1));
  });

  it("shows stored without assignment", async () => {
    await importWith({ status: "stored", movementId: "m1", matched: false });
    expect(await screen.findByText(/Registrado sin asignar/)).toBeInTheDocument();
  });

  it("shows a duplicate", async () => {
    await importWith({ status: "duplicate", movementId: "m1" });
    expect(await screen.findByText("Ya estaba registrado.")).toBeInTheDocument();
  });

  it("shows a readable DKIM reason", async () => {
    await importWith({ status: "ignored", reason: "dkim_failed", detail: "body_hash_mismatch" });
    expect(await screen.findByText("No se pudo verificar: el contenido del correo fue modificado.")).toBeInTheDocument();
  });

  it("shows the missing pieces of a mail that is not a payment", async () => {
    await importWith({ status: "ignored", reason: "not_a_payment", missing: ["transaction_number"] });
    expect(await screen.findByText(/No es un aviso de transferencia recibida \(falta o no coincide: número de transacción\)/)).toBeInTheDocument();
  });
});
