// Invented pilot snapshot for the import tests: fictional families, students and amounts only.
export type Rows = Record<string, unknown>[];
export interface PilotTables { collections: Rows; payments: Rows; students: Rows; bank_movements: Rows }

export const TENANT_ID = "c0000000-0000-4000-8000-0000000000c1";

const collection = (id: string, slug: string): Record<string, unknown> => ({
  id, slug, title: `Coleccion ${slug}`, eyebrow: null, description: "Descripcion de prueba", notes_json: "[]",
  options_json: '[{"key":"a","label":"Opcion A","cents":1400}]', deadline: "2026-12-15", status: "abierta", max_per_payment: 4,
  tone: "#C81E3A", cover_key: "covers/demo-cover.jpg", deuna_link: null, deuna_link_expires: null,
  created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z",
});
const payment = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, code: `C-${id}`, parent_name: `Familia ${id}`, phone: "0990000000", amount_cents: 2800, expected_cents: 2800,
  transfer_date: "2026-11-20", bank: "Banco Demo", reference: null, receipt_key: `receipts/${id}.jpg`, receipt_type: "image/jpeg",
  receipt_size: 1234, receipt_sha256: "ab".repeat(32), collection_id: "col-1", status: "pagado", review_note: null, verification: null,
  reviewed_by: "script", reviewed_at: "2026-11-21T10:00:00Z", paid_at: "2026-11-21T10:00:00Z",
  created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-21T10:00:00Z", ...over,
});
const student = (id: number, paymentId: string): Record<string, unknown> => ({ id, payment_id: paymentId, given_names: `Alumno ${id}`, surnames: "Demo", option_key: "a", option_cents: 1400 });
const movement = (id: string, paymentId: string | null, n: string): Record<string, unknown> => ({
  id, source: "deuna_email", transaction_number: n, amount_cents: 2800, received_at: "2026-11-20T09:00:00Z", origin_bank: null,
  origin_account: null, destination_account: null, payer_name: "Pagador Demo", motive: null, message_id: null, payment_id: paymentId,
  match_status: paymentId ? "auto" : "unmatched", match_score: paymentId ? 0.5 : null, created_at: "2026-11-20T09:00:00Z",
});

/** Students ids 7, 3 and 9 are out of insertion order on purpose: the import orders by old id. */
export function makeTables(): PilotTables {
  return {
    collections: [collection("col-1", "curso-demo"), collection("col-2", "viaje-demo")],
    payments: [payment("pay-1", { reviewed_by: "admin" }), payment("pay-2", { receipt_key: "receipts/pay-2.pdf", reviewed_by: null, status: "en_revision" }), payment("pay-3", { collection_id: "col-2", reviewed_by: "deuna" })],
    students: [student(7, "pay-1"), student(3, "pay-1"), student(9, "pay-2")],
    bank_movements: [movement("mov-1", "pay-1", "TX-1"), movement("mov-2", null, "TX-2")],
  };
}
