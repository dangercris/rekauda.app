-- One row per submitted transfer receipt. A receipt can cover one or more students.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  parent_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  expected_cents INTEGER NOT NULL,
  transfer_date TEXT NOT NULL,
  bank TEXT NOT NULL,
  reference TEXT,
  receipt_key TEXT NOT NULL,
  receipt_type TEXT NOT NULL,
  receipt_size INTEGER NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_revision'
    CHECK (status IN ('en_revision', 'recibido', 'observado', 'pagado', 'anulado')),
  review_note TEXT,
  verification TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id TEXT NOT NULL REFERENCES payments (id),
  given_names TEXT NOT NULL,
  surnames TEXT NOT NULL,
  costume TEXT NOT NULL CHECK (costume IN ('mujer', 'hombre'))
);

CREATE INDEX idx_students_payment ON students (payment_id);
CREATE INDEX idx_payments_status ON payments (status);
CREATE INDEX idx_payments_sha ON payments (receipt_sha256);
