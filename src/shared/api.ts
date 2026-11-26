/**
 * HTTP contract between the Worker (src/worker) and the web apps (src/client).
 * Both sides import these types; change them here first.
 * Money is always integer cents. Dates are ISO strings (date-only fields are YYYY-MM-DD, Ecuador calendar).
 */

// ---------------------------------------------------------------- shared enums

export const PAYMENT_STATUSES = ["en_revision", "recibido", "observado", "pagado", "anulado"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const COLLECTION_STATUSES = ["abierta", "cerrada", "archivada"] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

/** Option a student can be registered under (e.g. "Vestuario de mujer"), with its own price. */
export interface CollectionOption {
  /** `^[a-z0-9-]{1,24}$`, unique within the collection, immutable once used by a payment. */
  key: string;
  label: string;
  detail: string | null;
  cents: number;
}

/**
 * Visual identity of a collection ("evento"): the tone drives buttons, progress and ambient light;
 * the cover image is the hero and the source of the blurred ambient background.
 */
export interface CollectionTheme {
  /** `#RRGGBB`. */
  tone: string;
  /** Same-origin URL (`/api/covers/...`) or null when no cover was uploaded. */
  coverUrl: string | null;
}

export interface ApiError {
  error: string;
  /** Human message in Spanish, safe to show to the user. */
  message: string;
}

// ---------------------------------------------------------------- public API

/** Where families send the money. Shown with copy buttons; same for every collection. */
export interface TreasuryAccount {
  bank: string;
  accountType: string;
  accountNumber: string;
  holder: string;
  holderId: string;
  /** Deuna payment link (opens the app on phones); null when not available. */
  deunaUrl: string | null;
  /** Same-origin URL of the Deuna QR image, or null. */
  qrUrl: string | null;
  /** Which banks can transfer to Deuna and at what hours. */
  helpUrl: string | null;
}

/** GET /api/config */
export interface ConfigResponse {
  /** e.g. "1.º de Básica A". */
  className: string;
  /** e.g. "Mi Colegio". */
  schoolName: string;
  /** e.g. "1.º Básica A". Short form for titles and previews. */
  classShortName: string;
  /** One to three characters shown in the brand avatar. */
  classMark: string;
  banks: readonly string[];
  treasury: TreasuryAccount;
  /** ISO date (YYYY-MM-DD): transfers dated before it are rejected. */
  earliestTransferDate: string;
  /** `#RRGGBB` tone proposed for new collections. */
  defaultTone: string;
  analytics: { gaMeasurementId: string | null };
  /** How the admin signs in: the self-host password, or an emailed magic link (Cloud). */
  auth: { mode: "password" | "magic_link" };
}

/** Generic success body (login, logout, session). 401 means signed out. */
export interface OkResponse {
  ok: true;
}

/** Item of GET /api/collections (archived collections are excluded). */
export interface CollectionSummary extends CollectionTheme {
  slug: string;
  title: string;
  eyebrow: string | null;
  deadline: string;
  status: Exclude<CollectionStatus, "archivada">;
  options: CollectionOption[];
  /** Distinct students with a non-void payment. */
  registered: number;
  /** Of those, students whose best status is `pagado`. */
  paid: number;
}

/** GET /api/collections */
export interface CollectionsResponse {
  collections: CollectionSummary[];
}

/** GET /api/collections/:slug (404 `collection_not_found` when missing or archived). */
export interface CollectionDetail extends CollectionTheme {
  slug: string;
  title: string;
  eyebrow: string | null;
  description: string;
  notes: string[];
  deadline: string;
  status: Exclude<CollectionStatus, "archivada">;
  maxPerPayment: number;
  options: CollectionOption[];
  /**
   * Deuna charge link for this collection (usually for the exact amount), or null when none is set
   * or it already expired (the Worker decides, using the Ecuador calendar day).
   */
  deunaLink: string | null;
}

export interface BoardStudent {
  /** First given name + surname initial, e.g. "Ana M.". Never the full name. */
  name: string;
  option: string;
  optionLabel: string;
  status: Exclude<PaymentStatus, "anulado">;
}

export interface BoardTotals {
  registrados: number;
  pagado: number;
  recibido: number;
  en_revision: number;
  observado: number;
}

/** GET /api/collections/:slug/board */
export interface BoardResponse {
  students: BoardStudent[];
  totals: BoardTotals;
}

/**
 * POST /api/payments, multipart/form-data fields:
 * collection (slug), students (JSON of PaymentStudentInput[]), parentName, phone, transferDate (YYYY-MM-DD),
 * bank (one of ConfigResponse.banks), amount ("28.00"), reference (optional), consent ("si"),
 * hp_c9x (honeypot, must be empty), receipt (JPEG/PNG/WEBP/PDF, max 5 MB).
 */
export interface PaymentStudentInput {
  givenNames: string;
  surnames: string;
  /** CollectionOption.key */
  option: string;
}

export interface CreatePaymentResponse {
  ok: true;
  /** Tracking code `XXX-XXX`. */
  code: string;
  status: "en_revision";
}

/** GET /api/lookup/:code (rate limited per IP). */
export interface LookupResponse {
  code: string;
  status: PaymentStatus;
  /** Only for observado/anulado: why, written for the family. */
  note: string | null;
  amountCents: number;
  expectedCents: number;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  collection: { slug: string; title: string } | null;
  students: Array<{ name: string; option: string; optionLabel: string }>;
}

// ---------------------------------------------------------------- admin API (cookie session, same-origin POSTs)

export interface AdminCollectionStats {
  /** Non-void payments. */
  payments: number;
  /** Student counts below exclude void payments. */
  students: number;
  enRevision: number;
  recibido: number;
  observado: number;
  pagado: number;
  paidCents: number;
  expectedCents: number;
}

export interface AdminCollection extends CollectionTheme {
  id: string;
  slug: string;
  title: string;
  eyebrow: string | null;
  description: string;
  notes: string[];
  deadline: string;
  status: CollectionStatus;
  maxPerPayment: number;
  options: CollectionOption[];
  createdAt: string;
  updatedAt: string;
  /** As stored, even when expired (the admin needs to see and renew it). */
  deunaLink: string | null;
  /** YYYY-MM-DD (Ecuador): last day the link is offered. Null when there is no link or no expiry. */
  deunaLinkExpires: string | null;
  stats: AdminCollectionStats;
}

/** GET /api/admin/collections */
export interface AdminCollectionsResponse {
  collections: AdminCollection[];
}

/** POST /api/admin/collections (create) and POST /api/admin/collections/:id (partial update). */
export interface AdminCollectionInput {
  slug: string;
  title: string;
  eyebrow?: string | null;
  description: string;
  notes?: string[];
  options: CollectionOption[];
  deadline: string;
  maxPerPayment?: number;
  status?: CollectionStatus;
  tone?: string;
  /** Must start with https://pagar.deuna.app/ and have no spaces (max 1000). Empty or null clears it. */
  deunaLink?: string | null;
  /** YYYY-MM-DD, only kept when a link is set. */
  deunaLinkExpires?: string | null;
}

export interface AdminCollectionMutationResponse {
  ok: true;
  collection: AdminCollection;
}

/**
 * POST /api/admin/collections/:id/cover (multipart, field `cover`: JPEG/PNG/WEBP, max 5 MB) sets the cover.
 * DELETE /api/admin/collections/:id/cover removes it. Both return AdminCollectionMutationResponse.
 */

export interface AdminPaymentStudent {
  givenNames: string;
  surnames: string;
  option: string;
  optionLabel: string;
}

export const MOVEMENT_MATCH_STATUSES = ["auto", "manual", "unmatched", "ignored"] as const;
export type MovementMatchStatus = (typeof MOVEMENT_MATCH_STATUSES)[number];

/** Compact view of the Deuna notification linked to a payment (shown as "Confirmado por Deuna"). */
export interface PaymentBankMovement {
  id: string;
  transactionNumber: string;
  amountCents: number;
  payerName: string | null;
  originBank: string | null;
  /** ISO 8601 UTC. */
  receivedAt: string;
  matchStatus: MovementMatchStatus;
}

export interface AdminPayment {
  id: string;
  code: string;
  collectionId: string | null;
  parentName: string;
  phone: string;
  amountCents: number;
  expectedCents: number;
  transferDate: string;
  bank: string;
  reference: string | null;
  receiptType: string;
  receiptSize: number;
  status: PaymentStatus;
  reviewNote: string | null;
  verification: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  students: AdminPaymentStudent[];
  flags: {
    amountMismatch: boolean;
    duplicateReceipt: boolean;
    duplicateReference: boolean;
  };
  /** Incoming Deuna transfer that confirms this payment, or null when none was linked. */
  bankMovement: PaymentBankMovement | null;
}

/** GET /api/admin/payments?collection=<id> */
export interface AdminPaymentsResponse {
  payments: AdminPayment[];
}

/** POST /api/admin/payments/:id/status. `note` is required for observado and anulado. */
export interface AdminStatusInput {
  status: PaymentStatus;
  note?: string;
}

/** Response of POST /api/admin/payments/:id/status. Re-fetch the list for the updated row. */
export interface AdminStatusResponse {
  ok: true;
  status: PaymentStatus;
}

/**
 * Receipt file: GET /api/admin/receipts/:paymentId (images inline, PDFs as attachment).
 * Session: POST /api/admin/login {password}, POST /api/admin/logout, GET /api/admin/session.
 */

// ---------------------------------------------------------------- bank movements (Deuna emails)

/** An incoming transfer read from a Deuna notification email. Account numbers are masked as Deuna sends them. */
export interface AdminBankMovement extends PaymentBankMovement {
  originAccount: string | null;
  destinationAccount: string | null;
  motive: string | null;
  /** Set when linked (auto or manual). */
  paymentId: string | null;
  /** 0..1, only for automatic links. */
  matchScore: number | null;
  createdAt: string;
}

/** GET /api/admin/movements?status=unmatched|all (default unmatched), newest first, at most 200. */
export interface AdminMovementsResponse {
  movements: AdminBankMovement[];
}

/**
 * POST /api/admin/movements/:id/link {paymentId}: manual link (409 `payment_already_linked`,
 * `movement_already_linked`, `payment_void`). POST .../unlink and POST .../ignore take no body.
 * Linking moves en_revision and observado payments to recibido (never pagado: only the treasurer sets that).
 */
export interface AdminMovementLinkInput {
  paymentId: string;
}

export interface AdminMovementMutationResponse {
  ok: true;
  movement: AdminBankMovement;
}

// ---------------------------------------------------------------- Deuna .eml import

export const DEUNA_IGNORE_REASONS = [
  "invalid_message",
  "too_large",
  "sender_not_deuna",
  "dkim_failed",
  "dkim_unavailable",
  "not_a_payment",
  "wrong_account",
] as const;
export type DeunaIgnoreReason = (typeof DEUNA_IGNORE_REASONS)[number];

/** What happened to one DKIM-Signature header (d= and s= are public DNS names). */
export interface DkimSignatureAttempt {
  d: string | null;
  s: string | null;
  reason: string;
}

/**
 * Result of processing a raw Deuna notification (inbound email or admin import).
 * `ignored` means nothing was stored; `detail` is the DKIM failure reason for dkim_failed,
 * `missing` lists the parser pieces that were not found (never email content).
 */
export type DeunaImportResult =
  | {
      status: "stored";
      movementId: string;
      /** True when it was linked to a payment automatically. */
      matched: boolean;
      paymentId?: string;
      /** Tracking code of the linked payment (filled by the admin route). */
      paymentCode?: string;
    }
  | { status: "duplicate"; movementId: string }
  | {
      status: "ignored";
      reason: DeunaIgnoreReason;
      detail?: string;
      missing?: string[];
      signatures?: DkimSignatureAttempt[];
    };

/**
 * POST /api/admin/movements/import (multipart, field `eml`: the raw .eml, max 1 MB, same-origin + session).
 * Always answers 200 with a DeunaImportResult. The message must pass DKIM (d=deunaapp.com) like a real delivery.
 */
export type AdminMovementImportResponse = DeunaImportResult;
