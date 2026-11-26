/**
 * Admin routing. The admin lives at `/admin` and production falls back to the PUBLIC index.html for
 * unknown paths, so every admin screen is addressed by the hash only:
 *
 *   #resumen (default)   #pagos   #pagos/<status|todos>   #pago/<paymentId>
 *   #eventos             #evento/nuevo                   #evento/<collectionId>
 *   #movimientos
 */
import { PAYMENT_STATUSES, type PaymentStatus } from "../../shared/api";

export type StatusFilter = PaymentStatus | "todos";

export const STATUS_FILTERS: readonly StatusFilter[] = ["todos", "en_revision", "recibido", "observado", "pagado", "anulado"];

/** What the payments list shows when the hash has no status: the review queue. */
export const DEFAULT_STATUS_FILTER: StatusFilter = "en_revision";

export type AdminRoute =
  | { name: "resumen" }
  | { name: "pagos"; status: StatusFilter }
  | { name: "pago"; id: string }
  | { name: "eventos" }
  | { name: "movimientos" }
  /** `id: null` creates a new collection. */
  | { name: "evento"; id: string | null };

export type TabKey = "resumen" | "pagos" | "movimientos" | "eventos";

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isStatusFilter(value: string): value is StatusFilter {
  return value === "todos" || PAYMENT_STATUSES.some((status) => status === value);
}

/**
 * Maps a hash (with or without "#", already decoded) to a route. Empty hash is the summary.
 * Returns null for anything unknown so the caller can redirect to the summary.
 */
export function parseHash(hash: string): AdminRoute | null {
  const clean = (hash.startsWith("#") ? hash.slice(1) : hash).replace(/\/+$/, "");
  if (clean === "" || clean === "resumen") return { name: "resumen" };
  const [head, param, ...rest] = clean.split("/");
  if (rest.length > 0) return null;
  switch (head) {
    case "pagos":
      if (param === undefined) return { name: "pagos", status: DEFAULT_STATUS_FILTER };
      return isStatusFilter(param) ? { name: "pagos", status: param } : null;
    case "pago":
      return param !== undefined && ID_RE.test(param) ? { name: "pago", id: param } : null;
    case "eventos":
      return param === undefined ? { name: "eventos" } : null;
    case "movimientos":
      return param === undefined ? { name: "movimientos" } : null;
    case "evento":
      if (param === "nuevo") return { name: "evento", id: null };
      return param !== undefined && ID_RE.test(param) ? { name: "evento", id: param } : null;
    default:
      return null;
  }
}

/** Canonical hash (with "#") for a route. `#pagos` means the default review queue. */
export function toHash(route: AdminRoute): string {
  switch (route.name) {
    case "resumen":
      return "#resumen";
    case "pagos":
      return route.status === DEFAULT_STATUS_FILTER ? "#pagos" : `#pagos/${route.status}`;
    case "pago":
      return `#pago/${route.id}`;
    case "eventos":
      return "#eventos";
    case "movimientos":
      return "#movimientos";
    case "evento":
      return route.id === null ? "#evento/nuevo" : `#evento/${route.id}`;
  }
}

/** Which bottom/top tab is active for a route. */
export function tabOf(route: AdminRoute): TabKey {
  if (route.name === "pagos" || route.name === "pago") return "pagos";
  if (route.name === "movimientos") return "movimientos";
  if (route.name === "eventos" || route.name === "evento") return "eventos";
  return "resumen";
}

/** Detail screens hide the phone tab bar: their primary action lives in a sticky action bar. */
export function isDetailRoute(route: AdminRoute): boolean {
  return route.name === "pago" || route.name === "evento";
}

/** Same route, ignoring how the hash was spelled ("#pagos" vs "#pagos/en_revision"). */
export function sameRoute(a: AdminRoute, b: AdminRoute): boolean {
  return toHash(a) === toHash(b);
}
