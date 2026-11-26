import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, createPayment, errorMessage, getAdminSession, getCollection, normalizeTrackingCode, setPaymentStatus } from "./api";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("returns typed bodies and encodes path segments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { slug: "a b", title: "Musical" }));
    vi.stubGlobal("fetch", fetchMock);
    const detail = await getCollection("a b");
    expect(detail.title).toBe("Musical");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/collections/a%20b");
  });

  it("maps ApiError bodies to ApiRequestError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: "collection_not_found", message: "Esta recaudación no existe." })));
    const error = await getCollection("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, code: "collection_not_found", message: "Esta recaudación no existe." });
  });

  it("uses friendly fallbacks for non-JSON errors and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 502 })));
    await expect(getCollection("x")).rejects.toMatchObject({ status: 502, code: "http_502" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await getCollection("x").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(errorMessage(error)).toMatch(/conectarnos/);
    expect(errorMessage("weird")).toMatch(/No se pudo completar/);
  });

  it("rejects invalid JSON on success as invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(getCollection("x")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("builds the multipart payment form", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, code: "ABC-123", status: "en_revision" }));
    vi.stubGlobal("fetch", fetchMock);
    const receipt = new File(["x"], "captura.jpg", { type: "image/jpeg" });
    const res = await createPayment({
      collection: "musical",
      students: [{ givenNames: "Ana", surnames: "Pérez", option: "mujer" }],
      parentName: "Carolina Vásquez",
      phone: "0991234567",
      transferDate: "2026-11-26",
      bank: "Banco Pichincha",
      amountCents: 2800,
      receipt,
    });
    expect(res.code).toBe("ABC-123");
    const init: RequestInit | undefined = fetchMock.mock.calls[0]?.[1];
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) throw new Error("expected FormData");
    expect(body.get("amount")).toBe("28.00");
    expect(body.get("consent")).toBe("si");
    expect(body.get("hp_c9x")).toBe("");
    expect(body.get("reference")).toBeNull();
    expect(JSON.parse(String(body.get("students")))).toEqual([{ givenNames: "Ana", surnames: "Pérez", option: "mujer" }]);
    expect(body.get("receipt")).toBeInstanceOf(File);
  });

  it("reads the admin session as a boolean", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { ok: true })));
    await expect(getAdminSession()).resolves.toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "unauthorized", message: "Ingresa de nuevo." })));
    await expect(getAdminSession()).resolves.toBe(false);
  });

  it("extracts the payment from a status update when present", async () => {
    const payment = { id: "p1", code: "ABC-123", status: "pagado" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { ok: true, payment })));
    await expect(setPaymentStatus("p1", { status: "pagado" })).resolves.toMatchObject(payment);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { ok: true })));
    await expect(setPaymentStatus("p1", { status: "pagado" })).resolves.toBeNull();
  });

  it("normalizes tracking codes", () => {
    expect(normalizeTrackingCode("abc123")).toBe("ABC-123");
    expect(normalizeTrackingCode(" abc 123 ")).toBe("ABC-123");
    expect(normalizeTrackingCode("abc-123")).toBe("ABC-123");
  });
});
