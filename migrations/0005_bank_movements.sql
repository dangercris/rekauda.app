-- Incoming bank movements read from Deuna notification emails (Email Routing -> Worker email handler).
-- transaction_number is the idempotency key: the same email delivered twice inserts once.
-- match_status: auto (linked by the Worker), manual (linked by the treasurer), unmatched, ignored.
-- A payment can be linked to at most one movement (partial unique index).
CREATE TABLE bank_movements (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'deuna_email' CHECK (source IN ('deuna_email')),
  transaction_number TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  origin_bank TEXT,
  origin_account TEXT,
  destination_account TEXT,
  payer_name TEXT,
  motive TEXT,
  message_id TEXT,
  payment_id TEXT REFERENCES payments (id),
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('auto', 'manual', 'unmatched', 'ignored')),
  match_score REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_bank_movements_payment ON bank_movements (payment_id);
CREATE UNIQUE INDEX idx_bank_movements_payment_unique ON bank_movements (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_bank_movements_status ON bank_movements (match_status);
