import type { AdminBankMovement, AdminCollection, AdminPayment } from "../../../shared/api";

export function makeCollection(overrides: Partial<AdminCollection> = {}): AdminCollection {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    slug: "vestuario-musical",
    title: "Vestuario del musical",
    eyebrow: null,
    description: "Vestuario para la obra de fin de año.",
    notes: [],
    deadline: "2026-12-20",
    status: "abierta",
    maxPerPayment: 4,
    options: [
      { key: "mujer", label: "Vestuario de mujer", detail: null, cents: 1400 },
      { key: "hombre", label: "Vestuario de hombre", detail: null, cents: 1400 },
    ],
    tone: "#C81E3A",
    coverUrl: null,
    deunaLink: null,
    deunaLinkExpires: null,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
    stats: { payments: 0, students: 0, enRevision: 0, recibido: 0, observado: 0, pagado: 0, paidCents: 0, expectedCents: 0 },
    ...overrides,
  };
}

let seq = 0;

export function makePayment(overrides: Partial<AdminPayment> = {}): AdminPayment {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `AB${seq}-XYZ`,
    collectionId: "c0000000-0000-4000-8000-000000000001",
    parentName: "Carolina Vásquez",
    phone: "+593991234567",
    amountCents: 1400,
    expectedCents: 1400,
    transferDate: "2026-11-25",
    bank: "Banco Pichincha / Deuna",
    reference: `REF${seq}`,
    receiptType: "image/png",
    receiptSize: 2048,
    status: "en_revision",
    reviewNote: null,
    verification: null,
    reviewedBy: null,
    reviewedAt: null,
    paidAt: null,
    createdAt: "2026-11-25T15:00:00.000Z",
    students: [{ givenNames: "Mateo", surnames: "Andrade", option: "hombre", optionLabel: "Vestuario de hombre" }],
    flags: { amountMismatch: false, duplicateReceipt: false, duplicateReference: false },
    bankMovement: null,
    ...overrides,
  };
}

let movementSeq = 0;

export function makeMovement(overrides: Partial<AdminBankMovement> = {}): AdminBankMovement {
  movementSeq += 1;
  return {
    id: `10000000-0000-4000-8000-${String(movementSeq).padStart(12, "0")}`,
    transactionNumber: `50000000${String(movementSeq).padStart(4, "0")}`,
    amountCents: 1400,
    payerName: "Torres Mendez Lucia Ana",
    originBank: "Coop. Jep",
    originAccount: "********0000",
    destinationAccount: "******0000",
    motive: "Transf JEP",
    receivedAt: "2026-11-26T14:02:00.000Z",
    matchStatus: "unmatched",
    matchScore: null,
    paymentId: null,
    createdAt: "2026-11-26T14:03:00.000Z",
    ...overrides,
  };
}

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** Routes fetch calls to handlers by "METHOD path" (path without the query string); records every call. */
export function mockApi(routes: Record<string, Handler>): { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    const call = { method, url, body };
    calls.push(call);
    const path = url.split("?")[0] ?? url;
    const handler = routes[`${method} ${path}`];
    if (!handler) return json(404, { error: "not_found", message: `Sin mock para ${method} ${path}` });
    return handler(call);
  };
  return { fetch: fetchImpl, calls };
}
