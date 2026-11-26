-- Rekauda Cloud baseline schema (multi-tenant). Separate from the pilot migrations folder, which is never touched.
-- Every tenant-owned table carries tenant_id NOT NULL. Children reference parents with composite keys that
-- include tenant_id, so a row can never point at another tenant. Parents therefore expose UNIQUE (tenant_id, id).

-- r2_prefix is exactly t/<id>/ for cloud tenants. It can be empty only for self-hosted or imported pilot tenants,
-- and because r2_prefix is UNIQUE only one empty-prefix tenant can exist per database.
-- inbound_token_hash is the SHA-256 of the inbound mail token, never the token itself.
CREATE TABLE tenants (
  id TEXT NOT NULL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  r2_prefix TEXT NOT NULL UNIQUE,
  qr_key TEXT,
  inbound_token_hash TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'cloud' CHECK (source IN ('cloud', 'self_host', 'pilot_import')),
  legacy_prefix TEXT,
  paid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (r2_prefix <> '' OR source IN ('self_host', 'pilot_import')),
  CHECK (source <> 'cloud' OR r2_prefix = 't/' || id || '/')
);

-- Hostnames are stored lowercase without port. verified_at is set when the platform has confirmed control of the name.
-- Platform-created subdomains (kind subdomain) resolve without it. Custom domains resolve only once verified_at is set.
CREATE TABLE tenant_domains (
  hostname TEXT NOT NULL PRIMARY KEY CHECK (hostname = lower(hostname)),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  kind TEXT NOT NULL DEFAULT 'subdomain' CHECK (kind IN ('subdomain', 'custom')),
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tenant_domains_tenant ON tenant_domains (tenant_id);

CREATE TABLE users (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'synthetic')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Roles are per tenant. A user can belong to several tenants.
CREATE TABLE memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'co_treasurer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE UNIQUE INDEX idx_memberships_one_owner ON memberships (tenant_id) WHERE role = 'owner';

-- token_hash is the SHA-256 of the opaque cookie token.
CREATE TABLE sessions (
  token_hash TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_member ON sessions (tenant_id, user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Consuming a link must be ONE atomic UPDATE ... WHERE consumed_at IS NULL AND expires_at > ?, checking that exactly
-- one row changed. Never read first and write after, or two requests could both succeed.
CREATE TABLE magic_links (
  token_hash TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  email TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX idx_magic_links_email ON magic_links (tenant_id, email, created_at);
CREATE INDEX idx_magic_links_expires ON magic_links (expires_at);

CREATE TABLE collections (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  slug TEXT NOT NULL CHECK (slug = lower(slug)),
  title TEXT NOT NULL,
  eyebrow TEXT,
  description TEXT NOT NULL,
  notes_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL,
  deadline TEXT NOT NULL CHECK (deadline GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'cerrada', 'archivada')),
  max_per_payment INTEGER NOT NULL DEFAULT 4 CHECK (max_per_payment >= 1),
  tone TEXT NOT NULL DEFAULT '#C81E3A',
  cover_key TEXT,
  deuna_link TEXT,
  deuna_link_expires TEXT CHECK (deuna_link_expires IS NULL OR deuna_link_expires GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, id)
);

-- One row per submitted transfer receipt. A receipt can cover one or more students.
CREATE TABLE payments (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  expected_cents INTEGER NOT NULL CHECK (expected_cents >= 0),
  transfer_date TEXT NOT NULL CHECK (transfer_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  bank TEXT NOT NULL,
  reference TEXT,
  receipt_key TEXT NOT NULL,
  receipt_type TEXT NOT NULL,
  receipt_size INTEGER NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_revision'
    CHECK (status IN ('en_revision', 'recibido', 'observado', 'pagado', 'anulado')),
  review_note TEXT,
  verification TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, collection_id) REFERENCES collections (tenant_id, id)
);
CREATE INDEX idx_payments_status ON payments (tenant_id, status);
CREATE INDEX idx_payments_sha ON payments (tenant_id, receipt_sha256);
CREATE INDEX idx_payments_collection ON payments (tenant_id, collection_id);

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  given_names TEXT NOT NULL,
  surnames TEXT NOT NULL,
  option_key TEXT NOT NULL,
  option_cents INTEGER NOT NULL CHECK (option_cents >= 0),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id)
);
CREATE INDEX idx_students_payment ON students (tenant_id, payment_id);

-- Incoming bank movements. transaction_number is the idempotency key within a tenant.
-- A NULL payment_id skips the foreign key check, and a payment links to at most one movement.
CREATE TABLE bank_movements (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  source TEXT NOT NULL DEFAULT 'deuna_email' CHECK (source IN ('deuna_email')),
  transaction_number TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  received_at TEXT NOT NULL,
  origin_bank TEXT,
  origin_account TEXT,
  destination_account TEXT,
  payer_name TEXT,
  motive TEXT,
  message_id TEXT,
  payment_id TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('auto', 'manual', 'unmatched', 'ignored')),
  match_score REAL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, transaction_number),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id)
);
CREATE UNIQUE INDEX idx_bank_movements_payment_unique ON bank_movements (tenant_id, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_bank_movements_status ON bank_movements (tenant_id, match_status);
