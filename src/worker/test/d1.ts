/// <reference types="node" />
/**
 * Test double for D1 backed by node:sqlite, with the real migrations applied.
 * It implements only what the Worker uses: prepare().bind().run()/all()/first() and batch() (atomic).
 */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Param = string | number | null;

class FakeStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, params);
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.runSync();
  }

  runSync(): { success: true; meta: { changes: number } } {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

export interface TestDb {
  /** Shaped like the D1 binding the Worker code uses. */
  prepare(sql: string): FakeStatement;
  batch(statements: FakeStatement[]): Promise<Array<{ success: true; meta: { changes: number } }>>;
  /** Direct access for seeding and assertions. */
  sqlite: DatabaseSync;
}

/** Id of the collection every test database starts with (migrations create none: new schools start empty). */
export const SEED_COLLECTION_ID = "c0000000-0000-4000-8000-000000000001";

function seedCollection(sqlite: DatabaseSync): void {
  sqlite
    .prepare(
      `INSERT INTO collections (id, slug, title, eyebrow, description, notes_json, options_json, deadline, status, max_per_payment, created_at, updated_at)
       VALUES (?, 'vestuario-musical', 'Vestuario del musical', 'Musical de Navidad', 'Registra tu transferencia y adjunta el comprobante.',
         '["Los vestuarios se entregan en el colegio."]',
         '[{"key":"mujer","label":"Vestuario de mujer","detail":"Abuelas y mamás","cents":1400},{"key":"hombre","label":"Vestuario de hombre","detail":"Adolescentes","cents":1400}]',
         '2026-12-02', 'abierta', 4, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z')`,
    )
    .run(SEED_COLLECTION_ID);
}

export function createTestDb(): TestDb {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  seedCollection(sqlite);
  return {
    sqlite,
    prepare: (sql) => new FakeStatement(sqlite, sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => s.runSync());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

/** The Worker types its binding as D1Database; the double only covers the used surface. */
export function asD1(db: TestDb): D1Database {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return db as unknown as D1Database;
}

let seq = 0;

export interface SeedPayment {
  id?: string;
  parentName?: string;
  amountCents?: number;
  transferDate?: string;
  bank?: string;
  status?: "en_revision" | "recibido" | "observado" | "pagado" | "anulado";
  createdAt?: string;
  surnames?: string[];
}

/** Inserts a payment (into the collection seeded by createTestDb) with one student per surname. */
export function seedPayment(db: TestDb, overrides: SeedPayment = {}): string {
  seq += 1;
  const id = overrides.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const createdAt = overrides.createdAt ?? new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO payments (id, code, parent_name, phone, amount_cents, expected_cents, transfer_date, bank, reference, receipt_key,
         receipt_type, receipt_size, receipt_sha256, collection_id, status, created_at, updated_at)
       VALUES (?, ?, ?, '+593990000000', ?, ?, ?, ?, NULL, ?, 'image/png', 10, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `T${String(seq).padStart(2, "0")}-AAA`,
      overrides.parentName ?? "Carolina Vasquez",
      overrides.amountCents ?? 1400,
      overrides.amountCents ?? 1400,
      overrides.transferDate ?? "2026-11-26",
      overrides.bank ?? "Cooperativa JEP",
      `receipts/${id}.png`,
      `sha-${id}`,
      SEED_COLLECTION_ID,
      overrides.status ?? "en_revision",
      createdAt,
      createdAt,
    );
  for (const surnames of overrides.surnames ?? ["Andrade"]) {
    db.sqlite
      .prepare("INSERT INTO students (payment_id, given_names, surnames, option_key, option_cents) VALUES (?, 'Mateo', ?, 'mujer', 1400)")
      .run(id, surnames);
  }
  return id;
}
