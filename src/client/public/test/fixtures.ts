/** Test fixtures and a tiny fetch router for the public app tests. */
import { vi } from "vitest";
import type {
  BoardResponse,
  CollectionDetail,
  CollectionSummary,
  ConfigResponse,
  CreatePaymentResponse,
  LookupResponse,
} from "../../../shared/api";

export const config: ConfigResponse = {
  className: "1.º de Básica A",
  schoolName: "Mi Colegio",
  banks: ["Banco Pichincha / Deuna", "Produbanco", "Otro banco o cooperativa"],
  treasury: {
    bank: "Banco Pichincha",
    accountType: "Cuenta de ahorros",
    accountNumber: "0000000000",
    holder: "Titular de Prueba",
    holderId: "0100000000",
    deunaUrl: "https://pagar.deuna.app/test",
    qrUrl: "/deuna-qr.png",
    helpUrl: "https://example.com/ayuda",
  },
};

export const musical: CollectionDetail = {
  slug: "vestuario-musical",
  title: "Vestuario del musical",
  eyebrow: "Musical de Navidad",
  description: "Vestuario para la obra de fin de año.",
  notes: ["Se entrega en el colegio."],
  deadline: "2026-12-02",
  status: "abierta",
  maxPerPayment: 4,
  options: [
    { key: "mujer", label: "Vestuario de mujer", detail: "Abuelas y mamás", cents: 1400 },
    { key: "hombre", label: "Vestuario de hombre", detail: "Adolescentes", cents: 1400 },
  ],
  tone: "#C81E3A",
  coverUrl: null,
  deunaLink: null,
};

export const trip: CollectionDetail = {
  ...musical,
  slug: "viaje-fin-de-ano",
  title: "Viaje de fin de año",
  maxPerPayment: 3,
  options: [
    { key: "estudiante", label: "Estudiante", detail: null, cents: 2600 },
    { key: "acompanante", label: "Acompañante", detail: null, cents: 3500 },
  ],
};

export const gift: CollectionDetail = {
  ...musical,
  slug: "regalo-de-graduacion",
  title: "Regalo de graduación",
  options: [{ key: "aporte", label: "Aporte por estudiante", detail: null, cents: 1250 }],
};

export const closed: CollectionDetail = { ...musical, slug: "rifa-cerrada", title: "Rifa cerrada", status: "cerrada" };

export function summary(detail: CollectionDetail, registered = 0, paid = 0): CollectionSummary {
  const { slug, title, eyebrow, deadline, status, options, tone, coverUrl } = detail;
  return { slug, title, eyebrow, deadline, status, options, tone, coverUrl, registered, paid };
}

export const emptyBoard: BoardResponse = {
  students: [],
  totals: { registrados: 0, pagado: 0, recibido: 0, en_revision: 0, observado: 0 },
};

export function lookupFor(code: string, overrides: Partial<LookupResponse> = {}): LookupResponse {
  return {
    code,
    status: "en_revision",
    note: null,
    amountCents: 2800,
    expectedCents: 2800,
    createdAt: "2026-11-26T15:00:00Z",
    reviewedAt: null,
    paidAt: null,
    collection: { slug: musical.slug, title: musical.title },
    students: [{ name: "Mateo A.", option: "mujer", optionLabel: "Vestuario de mujer" }],
    ...overrides,
  };
}

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type Handler = (request: { url: string; method: string; body: BodyInit | null | undefined }) => Response | Promise<Response>;

/** Routes fetch calls by "METHOD /path" (exact) or "METHOD /prefix*". Unknown routes answer 404. */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = `${method} ${path}`;
    const exact = routes[key];
    const handler = exact ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) return json(404, { error: "not_found", message: "No encontrado." });
    return handler({ url: path, method, body: init?.body });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function baseRoutes(collections: CollectionDetail[], extra: Record<string, Handler> = {}): Record<string, Handler> {
  const routes: Record<string, Handler> = {
    "GET /api/config": () => json(200, config),
    "GET /api/collections": () => json(200, { collections: collections.map((c) => summary(c)) }),
  };
  for (const c of collections) {
    routes[`GET /api/collections/${c.slug}`] = () => json(200, c);
    routes[`GET /api/collections/${c.slug}/board`] = () => json(200, emptyBoard);
  }
  return { ...routes, ...extra };
}

export const created = (code: string): CreatePaymentResponse => ({ ok: true, code, status: "en_revision" });

export function setLocation(url: string): void {
  window.history.replaceState(null, "", url);
}

/** A tiny PNG receipt (kept as is by prepareReceipt: small and an accepted type). */
export function pngFile(name = "comprobante.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], name, { type: "image/png" });
}
