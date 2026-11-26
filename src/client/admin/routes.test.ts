import { describe, expect, it } from "vitest";
import { isDetailRoute, parseHash, sameRoute, tabOf, toHash } from "./routes";

describe("admin hash router", () => {
  it("maps every documented hash to a route", () => {
    expect(parseHash("")).toEqual({ name: "resumen" });
    expect(parseHash("#resumen")).toEqual({ name: "resumen" });
    expect(parseHash("pagos")).toEqual({ name: "pagos", status: "en_revision" });
    expect(parseHash("#pagos/recibido")).toEqual({ name: "pagos", status: "recibido" });
    expect(parseHash("pagos/todos")).toEqual({ name: "pagos", status: "todos" });
    expect(parseHash("pago/3ae3dfd7-f0ce-4551-bfa7-a7d90e590988")).toEqual({ name: "pago", id: "3ae3dfd7-f0ce-4551-bfa7-a7d90e590988" });
    expect(parseHash("eventos")).toEqual({ name: "eventos" });
    expect(parseHash("#movimientos")).toEqual({ name: "movimientos" });
    expect(parseHash("evento/nuevo")).toEqual({ name: "evento", id: null });
    expect(parseHash("evento/abc-123")).toEqual({ name: "evento", id: "abc-123" });
    expect(parseHash("pagos/")).toEqual({ name: "pagos", status: "en_revision" });
  });

  it("rejects unknown or malformed hashes", () => {
    for (const hash of ["contenido", "pagos/pendiente", "pago", "pago/<script>", "evento", "eventos/x", "pagos/recibido/extra", "evento/a b", "movimientos/x"]) {
      expect(parseHash(hash)).toBeNull();
    }
  });

  it("builds canonical hashes that parse back to the same route", () => {
    expect(toHash({ name: "pagos", status: "en_revision" })).toBe("#pagos");
    expect(toHash({ name: "pagos", status: "anulado" })).toBe("#pagos/anulado");
    expect(toHash({ name: "evento", id: null })).toBe("#evento/nuevo");
    for (const hash of ["#resumen", "#pagos", "#pagos/observado", "#pago/x1", "#eventos", "#movimientos", "#evento/nuevo", "#evento/c1"]) {
      const route = parseHash(hash);
      expect(route && toHash(route)).toBe(hash);
    }
    expect(sameRoute({ name: "pagos", status: "en_revision" }, parseHash("#pagos/en_revision") ?? { name: "resumen" })).toBe(true);
  });

  it("knows the active tab and which screens are details", () => {
    expect(tabOf({ name: "pago", id: "x" })).toBe("pagos");
    expect(tabOf({ name: "evento", id: null })).toBe("eventos");
    expect(tabOf({ name: "resumen" })).toBe("resumen");
    expect(tabOf({ name: "movimientos" })).toBe("movimientos");
    expect(isDetailRoute({ name: "pago", id: "x" })).toBe(true);
    expect(isDetailRoute({ name: "pagos", status: "todos" })).toBe(false);
  });
});
