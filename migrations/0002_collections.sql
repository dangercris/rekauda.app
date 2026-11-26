-- Many collections per class (costumes, trips, gifts...). Each one has its own options and prices.
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  eyebrow TEXT,
  description TEXT NOT NULL,
  notes_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL,
  deadline TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'abierta'
    CHECK (status IN ('abierta', 'cerrada', 'archivada')),
  max_per_payment INTEGER NOT NULL DEFAULT 4,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Note: this migration used to seed the first collection of the original instance. New databases start with no
-- collections (create them from the admin panel). The seed was removed from this file only: databases that already
-- applied 0002 keep their data, because D1 tracks migrations by name and never re-runs them.

ALTER TABLE payments ADD COLUMN collection_id TEXT REFERENCES collections (id);
UPDATE payments SET collection_id = 'c0000000-0000-4000-8000-000000000001';
CREATE INDEX idx_payments_collection ON payments (collection_id);

-- The old CHECK on costume has to go, so students is rebuilt.
CREATE TABLE students_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id TEXT NOT NULL REFERENCES payments (id),
  given_names TEXT NOT NULL,
  surnames TEXT NOT NULL,
  option_key TEXT NOT NULL,
  option_cents INTEGER NOT NULL
);

INSERT INTO students_new (id, payment_id, given_names, surnames, option_key, option_cents)
SELECT id, payment_id, given_names, surnames, costume, 1400 FROM students;

DROP TABLE students;
ALTER TABLE students_new RENAME TO students;
CREATE INDEX idx_students_payment ON students (payment_id);
