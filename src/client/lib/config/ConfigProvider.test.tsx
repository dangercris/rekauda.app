import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantA, tenantB } from "../../test/tenants";
import { renderWithConfig } from "../../test/renderWithConfig";
import { BOOT_SCRIPT_ID } from "./boot";
import { ConfigProvider } from "./ConfigProvider";
import { useInstanceConfig } from "./useInstance";

function Probe() {
  const config = useInstanceConfig();
  return (
    <p>
      {config.schoolName}|{config.earliestTransferLabel}|{config.auth.mode}
    </p>
  );
}

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function addBootTag(json: string): void {
  const tag = document.createElement("script");
  tag.type = "application/json";
  tag.id = BOOT_SCRIPT_ID;
  tag.textContent = json;
  document.head.appendChild(tag);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById(BOOT_SCRIPT_ID)?.remove();
});

describe("ConfigProvider with the boot JSON", () => {
  it("renders the tenant values on the first render, without a request", () => {
    addBootTag(JSON.stringify(tenantB));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    // Synchronous: no await, no loading state in between.
    expect(screen.getByText("Instituto Boreal|marzo de 2027|magic_link")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves another tenant's values from another boot tag", () => {
    addBootTag(JSON.stringify(tenantA));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(screen.getByText("Colegio Aurora|noviembre de 2026|password")).toBeInTheDocument();
  });
});

describe("ConfigProvider fetch fallback", () => {
  it("shows an accessible loading state, then the fetched values", async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    expect(screen.queryByText(/Instituto Boreal/)).toBeNull();
    finish(reply(200, tenantB));
    expect(await screen.findByText("Instituto Boreal|marzo de 2027|magic_link")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/config");
  });

  it("falls back to the request when the boot JSON is invalid", async () => {
    addBootTag(JSON.stringify({ ...tenantA, defaultTone: "red" }));
    fetchMock.mockResolvedValue(reply(200, tenantB));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByText("Instituto Boreal|marzo de 2027|magic_link")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error with retry when the answer fails validation, and recovers on retry", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ...tenantA, auth: { mode: "sso" } })).mockResolvedValueOnce(reply(200, tenantA));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar la configuración");
    expect(screen.queryByText(/sso/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Colegio Aurora|noviembre de 2026|password")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the error state on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa tu conexión");
  });

  it("renders the not-found message for a 404 and offers no retry", async () => {
    fetchMock.mockResolvedValue(reply(404, { error: "not_found", message: "No encontrado." }));
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta página no existe");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });
});

describe("ConfigProvider with an invalid initial config", () => {
  it("does not crash: it asks /api/config instead", async () => {
    fetchMock.mockResolvedValue(reply(200, tenantB));
    render(
      <ConfigProvider initial={{ ...tenantA, defaultTone: "red" }}>
        <Probe />
      </ConfigProvider>,
    );
    expect(await screen.findByText("Instituto Boreal|marzo de 2027|magic_link")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("renderWithConfig", () => {
  it("provides the given config, tenant A by default", () => {
    renderWithConfig(<Probe />);
    expect(screen.getByText("Colegio Aurora|noviembre de 2026|password")).toBeInTheDocument();
  });

  it("provides tenant B when asked", () => {
    renderWithConfig(<Probe />, tenantB);
    expect(screen.getByText("Instituto Boreal|marzo de 2027|magic_link")).toBeInTheDocument();
  });
});

describe("useInstanceConfig", () => {
  it("throws outside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ConfigProvider/);
  });
});
