import type { CollectionStatus, PaymentStatus } from "../shared/api";

/** D1 row shapes (snake_case, as stored). */

export type PaymentRow = {
  id: string;
  code: string;
  parent_name: string;
  phone: string;
  amount_cents: number;
  expected_cents: number;
  transfer_date: string;
  bank: string;
  reference: string | null;
  receipt_key: string;
  receipt_type: string;
  receipt_size: number;
  receipt_sha256: string;
  collection_id: string;
  status: PaymentStatus;
  review_note: string | null;
  verification: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CollectionRow = {
  id: string;
  slug: string;
  title: string;
  eyebrow: string | null;
  description: string;
  notes_json: string;
  options_json: string;
  deadline: string;
  status: CollectionStatus;
  max_per_payment: number;
  tone: string;
  cover_key: string | null;
  deuna_link: string | null;
  /** YYYY-MM-DD (Ecuador): last day the link is offered to families. */
  deuna_link_expires: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicStatus = Exclude<CollectionStatus, "archivada">;

/** A collection the public may see (never archived). */
export type PublicCollectionRow = CollectionRow & { status: PublicStatus };

export function isPublicRow(row: CollectionRow): row is PublicCollectionRow {
  return row.status !== "archivada";
}

export type StudentStatusRow = {
  collection_id: string;
  given_names: string;
  surnames: string;
  option_key: string;
  status: PaymentStatus;
};

export type MatchStatus = "auto" | "manual" | "unmatched" | "ignored";

export type BankMovementRow = {
  id: string;
  source: "deuna_email";
  transaction_number: string;
  amount_cents: number;
  received_at: string;
  origin_bank: string | null;
  origin_account: string | null;
  destination_account: string | null;
  payer_name: string | null;
  motive: string | null;
  message_id: string | null;
  payment_id: string | null;
  match_status: MatchStatus;
  match_score: number | null;
  created_at: string;
};
