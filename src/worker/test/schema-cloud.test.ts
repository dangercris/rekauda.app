import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCloudTestDb, seedTenants, TENANT_A, TENANT_B } from "./d1-cloud";

const NOW = "2026-11-26T00:00:00.000Z";
const TENANT_TABLES = ["collections", "payments", "students", "bank_movements", "memberships", "sessions", "magic_links"];

function seeded() {
  const db = createCloudTestDb();
  seedTenants(db);
  return db;
}

const collectionOf = (db: ReturnType<typeof seeded>, tenant: string): string =>
  (db.sqlite.prepare("SELECT id FROM collections WHERE tenant_id = ?").get(tenant) as { id: string }).id;

function insertPayment(db: ReturnType<typeof seeded>, id: string, tenant: string, collection: string, code = id): void {
  db.sqlite
    .prepare(
      `INSERT INTO payments (id, tenant_id, code, parent_name, phone, amount_cents, expected_cents, transfer_date, bank, receipt_key,
         receipt_type, receipt_size, receipt_sha256, collection_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Parent', '+593990000000', 1400, 1400, '2026-11-26', 'Bank', 'k', 'image/png', 1, 'sha', ?4, ?5, ?5)`,
    )
    .run(id, tenant, code, collection, NOW);
}

/** Inserts a payment with one column overridden, to probe a single CHECK. */
function insertPaymentWith(db: ReturnType<typeof seeded>, column: string, value: string | number, collection: string): void {
  const base: Record<string, string | number> = { id: "p-x", tenant_id: TENANT_A, code: "X", parent_name: "P", phone: "1", amount_cents: 1, expected_cents: 1, transfer_date: "2026-11-26", bank: "B", receipt_key: "k", receipt_type: "t", receipt_size: 1, receipt_sha256: "s", collection_id: collection, created_at: NOW, updated_at: NOW };
  base[column] = value;
  const names = Object.keys(base);
  db.sqlite.prepare(`INSERT INTO payments (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(base));
}

function insertMovement(db: ReturnType<typeof seeded>, id: string, tenant: string, tx: string, paymentId: string | null = null): void {
  db.sqlite
    .prepare("INSERT INTO bank_movements (id, tenant_id, transaction_number, amount_cents, received_at, payment_id, created_at) VALUES (?, ?, ?, 1400, ?, ?, ?)")
    .run(id, tenant, tx, NOW, paymentId, NOW);
}

describe("cloud schema: tenant isolation constraints", () => {
  it("allows the same payment code and transaction number in tenants A and B", () => {
    const db = seeded();
    insertPayment(db, "p-a", TENANT_A, collectionOf(db, TENANT_A), "SAME-1");
    insertPayment(db, "p-b", TENANT_B, collectionOf(db, TENANT_B), "SAME-1");
    insertMovement(db, "m-a", TENANT_A, "TX-1");
    insertMovement(db, "m-b", TENANT_B, "TX-1");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bank_movements WHERE transaction_number = 'TX-1'").get()).toEqual({ n: 2 });
  });

  it("rejects a duplicate payment code or transaction number inside one tenant", () => {
    const db = seeded();
    insertPayment(db, "p-1", TENANT_A, collectionOf(db, TENANT_A), "DUP");
    expect(() => insertPayment(db, "p-2", TENANT_A, collectionOf(db, TENANT_A), "DUP")).toThrow(/UNIQUE/);
    insertMovement(db, "m-1", TENANT_A, "TX-9");
    expect(() => insertMovement(db, "m-2", TENANT_A, "TX-9")).toThrow(/UNIQUE/);
  });

  it("rejects a payment that points at a collection of another tenant", () => {
    const db = seeded();
    expect(() => insertPayment(db, "p-x", TENANT_A, collectionOf(db, TENANT_B))).toThrow(/FOREIGN KEY/);
  });

  it("rejects a movement linked to a payment of another tenant, and a student of another tenant", () => {
    const db = seeded();
    insertPayment(db, "p-b", TENANT_B, collectionOf(db, TENANT_B));
    expect(() => insertMovement(db, "m-x", TENANT_A, "TX-X", "p-b")).toThrow(/FOREIGN KEY/);
    expect(() =>
      db.sqlite.prepare("INSERT INTO students (tenant_id, payment_id, given_names, surnames, option_key, option_cents) VALUES (?, 'p-b', 'N', 'S', 'k', 1)").run(TENANT_A),
    ).toThrow(/FOREIGN KEY/);
  });

  it("skips the payment foreign key when payment_id is NULL and links one movement per payment", () => {
    const db = seeded();
    insertMovement(db, "m-1", TENANT_A, "TX-1");
    insertMovement(db, "m-2", TENANT_A, "TX-2");
    insertPayment(db, "p-a", TENANT_A, collectionOf(db, TENANT_A));
    insertMovement(db, "m-3", TENANT_A, "TX-3", "p-a");
    expect(() => insertMovement(db, "m-4", TENANT_A, "TX-4", "p-a")).toThrow(/UNIQUE/);
  });

  it("enforces the status, source, match, role and kind CHECKs", () => {
    const db = seeded();
    const col = collectionOf(db, TENANT_A);
    expect(() => db.sqlite.prepare("UPDATE tenants SET status = 'gone' WHERE id = ?").run(TENANT_A)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE tenants SET source = 'other' WHERE id = ?").run(TENANT_A)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE collections SET status = 'x' WHERE id = ?").run(col)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE memberships SET role = 'admin' WHERE tenant_id = ?").run(TENANT_A)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE users SET kind = 'bot'").run()).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE tenant_domains SET kind = 'x'").run()).toThrow(/CHECK/);
    insertPayment(db, "p-a", TENANT_A, col);
    expect(() => db.sqlite.prepare("UPDATE payments SET status = 'paid' WHERE id = 'p-a'").run()).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("INSERT INTO bank_movements (id, tenant_id, source, transaction_number, amount_cents, received_at, created_at) VALUES ('m', ?, 'x', 't', 1, ?, ?)").run(TENANT_A, NOW, NOW)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("INSERT INTO bank_movements (id, tenant_id, match_status, transaction_number, amount_cents, received_at, created_at) VALUES ('m', ?, 'x', 't', 1, ?, ?)").run(TENANT_A, NOW, NOW)).toThrow(/CHECK/);
  });

  it("allows one owner per tenant and any number of co-treasurers", () => {
    const db = seeded();
    db.sqlite.prepare("INSERT INTO users (id, email, kind, created_at) VALUES ('u3', 'third@example.test', 'person', ?)").run(NOW);
    expect(() => db.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, 'u3', 'owner', ?)").run(TENANT_A, NOW)).toThrow(/UNIQUE/);
    db.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, 'u3', 'co_treasurer', ?)").run(TENANT_A, NOW);
  });

  it("binds a session to an existing membership of the same tenant", () => {
    const db = seeded();
    const owner = db.sqlite.prepare("SELECT user_id FROM memberships WHERE tenant_id = ?").get(TENANT_B) as { user_id: string };
    const insert = db.sqlite.prepare("INSERT INTO sessions (token_hash, tenant_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)");
    expect(() => insert.run("h1", TENANT_A, owner.user_id, NOW, NOW)).toThrow(/FOREIGN KEY/);
    insert.run("h2", TENANT_B, owner.user_id, NOW, NOW);
  });

  it("stores the inbound token only as a unique hash", () => {
    const db = seeded();
    const cols = db.sqlite.prepare("PRAGMA table_info(tenants)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("inbound_token_hash");
    expect(cols.map((c) => c.name)).not.toContain("inbound_token");
    const hash = (db.sqlite.prepare("SELECT inbound_token_hash AS h FROM tenants WHERE id = ?").get(TENANT_A) as { h: string }).h;
    expect(() => db.sqlite.prepare("UPDATE tenants SET inbound_token_hash = ? WHERE id = ?").run(hash, TENANT_B)).toThrow(/UNIQUE/);
  });

  it("allows an empty r2_prefix only for self_host and pilot_import tenants", () => {
    const db = seeded();
    expect(() => db.sqlite.prepare("UPDATE tenants SET r2_prefix = '' WHERE id = ?").run(TENANT_A)).toThrow(/CHECK/);
    db.sqlite.prepare("UPDATE tenants SET r2_prefix = '', source = 'pilot_import' WHERE id = ?").run(TENANT_A);
  });

  it("has tenant_id NOT NULL on every tenant-owned table", () => {
    const db = createCloudTestDb();
    for (const table of TENANT_TABLES) {
      const col = (db.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>).find((c) => c.name === "tenant_id");
      expect(col?.notnull, table).toBe(1);
    }
  });

  it("keeps students.id as an autoincrement integer like the pilot", () => {
    const db = seeded();
    const col = db.sqlite.prepare("PRAGMA table_info(students)").all() as Array<{ name: string; type: string }>;
    expect(col.find((c) => c.name === "id")?.type).toBe("INTEGER");
    insertPayment(db, "p-a", TENANT_A, collectionOf(db, TENANT_A));
    const insert = db.sqlite.prepare("INSERT INTO students (tenant_id, payment_id, given_names, surnames, option_key, option_cents) VALUES (?, 'p-a', 'N', 'S', 'k', 1)");
    expect(Number(insert.run(TENANT_A).lastInsertRowid)).toBe(1);
    expect(Number(insert.run(TENANT_A).lastInsertRowid)).toBe(2);
  });

  it("declares the composite UNIQUE (tenant_id, id) that child foreign keys need", () => {
    const db = createCloudTestDb();
    for (const table of ["collections", "payments"]) {
      const indexes = db.sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>;
      const columns = indexes.filter((i) => i.unique).map((i) => (db.sqlite.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>).map((c) => c.name).join(","));
      expect(columns, table).toContain("tenant_id,id");
    }
  });

  it("makes every TEXT primary key NOT NULL", () => {
    const db = createCloudTestDb();
    const tables = (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables.length).toBeGreaterThanOrEqual(10);
    for (const table of tables) {
      const pk = (db.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; pk: number }>).filter((c) => c.pk > 0 && c.type === "TEXT");
      for (const c of pk) expect(c.notnull, `${table}.${c.name}`).toBe(1);
    }
  });

  it("requires a cloud tenant r2_prefix to be exactly t/<id>/", () => {
    const db = seeded();
    expect(() => db.sqlite.prepare("UPDATE tenants SET r2_prefix = 't/other/' WHERE id = ?").run(TENANT_A)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE tenants SET r2_prefix = 't/' || id WHERE id = ?").run(TENANT_A)).toThrow(/CHECK/);
    db.sqlite.prepare("UPDATE tenants SET r2_prefix = 't/' || id || '/' WHERE id = ?").run(TENANT_A);
    db.sqlite.prepare("UPDATE tenants SET source = 'self_host', r2_prefix = 'custom/' WHERE id = ?").run(TENANT_A);
  });

  it("allows only one empty-prefix tenant (r2_prefix is UNIQUE)", () => {
    const db = seeded();
    db.sqlite.prepare("UPDATE tenants SET source = 'self_host', r2_prefix = '' WHERE id = ?").run(TENANT_A);
    expect(() => db.sqlite.prepare("UPDATE tenants SET source = 'pilot_import', r2_prefix = '' WHERE id = ?").run(TENANT_B)).toThrow(/UNIQUE/);
  });

  it("compares emails case-insensitively", () => {
    const db = seeded();
    expect(() => db.sqlite.prepare("INSERT INTO users (id, email, kind, created_at) VALUES ('u9', 'OWNER-A@EXAMPLE.TEST', 'person', ?)").run(NOW)).toThrow(/UNIQUE/);
    db.sqlite.prepare("INSERT INTO magic_links (token_hash, tenant_id, email, created_at, expires_at) VALUES ('h', ?, 'Mixed@Example.Test', ?, ?)").run(TENANT_A, NOW, NOW);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM magic_links WHERE email = 'mixed@example.test'").get()).toEqual({ n: 1 });
  });

  it("stores hostnames and collection slugs lowercase only", () => {
    const db = seeded();
    expect(() => db.sqlite.prepare("INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES ('Demo.Localhost', ?, 'custom', ?)").run(TENANT_A, NOW)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE collections SET slug = 'Upper' WHERE tenant_id = ?").run(TENANT_A)).toThrow(/CHECK/);
  });

  it("keeps tenant_domains hostnames unique and tied to a real tenant", () => {
    const db = seeded();
    const insert = db.sqlite.prepare("INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES (?, ?, 'custom', ?)");
    expect(() => insert.run("demo-a.localhost", TENANT_B, NOW)).toThrow(/UNIQUE/);
    expect(() => insert.run("ghost.localhost", "missing-tenant", NOW)).toThrow(/FOREIGN KEY/);
  });

  it("deletes sessions when their membership is deleted (ON DELETE CASCADE)", () => {
    const db = seeded();
    const owner = db.sqlite.prepare("SELECT user_id FROM memberships WHERE tenant_id = ?").get(TENANT_A) as { user_id: string };
    db.sqlite.prepare("INSERT INTO sessions (token_hash, tenant_id, user_id, created_at, expires_at) VALUES ('h', ?, ?, ?, ?)").run(TENANT_A, owner.user_id, NOW, NOW);
    db.sqlite.prepare("DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?").run(TENANT_A, owner.user_id);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("indexes the lookups auth and expiry sweeps need", () => {
    const db = createCloudTestDb();
    const indexed = (table: string) => (db.sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((i) => (db.sqlite.prepare(`PRAGMA index_info(${i.name})`).all() as Array<{ name: string }>).map((c) => c.name).join(","));
    expect(indexed("sessions")).toEqual(expect.arrayContaining(["tenant_id,user_id", "expires_at"]));
    expect(indexed("magic_links")).toContain("expires_at");
  });

  it("rejects negative money, invalid json, malformed dates and a zero cap", () => {
    const db = seeded();
    const col = collectionOf(db, TENANT_A);
    expect(() => db.sqlite.prepare("UPDATE tenants SET config_json = 'not json' WHERE id = ?").run(TENANT_A)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE collections SET deadline = '2026-1-5' WHERE id = ?").run(col)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("UPDATE collections SET deuna_link_expires = 'tomorrow' WHERE id = ?").run(col)).toThrow(/CHECK/);
    db.sqlite.prepare("UPDATE collections SET deuna_link_expires = NULL WHERE id = ?").run(col);
    expect(() => db.sqlite.prepare("UPDATE collections SET max_per_payment = 0 WHERE id = ?").run(col)).toThrow(/CHECK/);
    expect(() => insertPaymentWith(db, "amount_cents", -1, col)).toThrow(/CHECK/);
    expect(() => insertPaymentWith(db, "expected_cents", -1, col)).toThrow(/CHECK/);
    expect(() => insertPaymentWith(db, "transfer_date", "26/11/2026", col)).toThrow(/CHECK/);
    expect(() => db.sqlite.prepare("INSERT INTO bank_movements (id, tenant_id, transaction_number, amount_cents, received_at, created_at) VALUES ('m', ?, 't', -5, ?, ?)").run(TENANT_A, NOW, NOW)).toThrow(/CHECK/);
    insertPayment(db, "p-ok", TENANT_A, col);
    expect(() => db.sqlite.prepare("INSERT INTO students (tenant_id, payment_id, given_names, surnames, option_key, option_cents) VALUES (?, 'p-ok', 'N', 'S', 'k', -1)").run(TENANT_A)).toThrow(/CHECK/);
  });
});

describe("cloud schema: seed and files", () => {
  it("applies the local seed twice without duplicating anything", () => {
    const db = seeded();
    const count = () => db.sqlite.prepare("SELECT (SELECT COUNT(*) FROM tenants) t, (SELECT COUNT(*) FROM tenant_domains) d, (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM memberships) m, (SELECT COUNT(*) FROM collections) c").get();
    const before = count();
    seedTenants(db);
    expect(count()).toEqual(before);
    expect(before).toMatchObject({ t: 2 });
    expect((db.sqlite.prepare("SELECT slug FROM tenants ORDER BY slug").all() as Array<{ slug: string }>).map((r) => r.slug)).toEqual(["demo-a", "demo-b"]);
  });

  it("seeds with ON CONFLICT DO NOTHING instead of INSERT OR IGNORE", () => {
    const sql = readFileSync(new URL("../../../scripts/cloud-seed.local.sql", import.meta.url), "utf8");
    expect(sql).not.toMatch(/OR IGNORE/i);
    expect(sql.match(/ON CONFLICT DO NOTHING/g)?.length).toBe(5);
  });

  it("documents that magic link consumption must be one atomic UPDATE", () => {
    const sql = readFileSync(new URL("../../../migrations-cloud/0001_baseline.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/-- .*atomic UPDATE.*consumed_at IS NULL AND expires_at > \?/);
  });

  it("keeps SQL comments free of semicolons and unbalanced quotes (the D1 runner splits on them)", () => {
    const dirs = [new URL("../../../migrations-cloud/", import.meta.url)];
    const files = [new URL("../../../scripts/cloud-seed.local.sql", import.meta.url)];
    for (const dir of dirs) for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) files.push(new URL(f, dir));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const at = line.indexOf("--");
        if (at < 0) continue;
        const comment = line.slice(at);
        expect(comment, `${file.pathname}: ${line}`).not.toContain(";");
        expect((comment.match(/['"]/g) ?? []).length % 2, `${file.pathname}: ${line}`).toBe(0);
      }
    }
  });
});
