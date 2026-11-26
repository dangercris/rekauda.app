/**
 * The only door from tenant handlers to D1. SQL is checked by assertTenantScoped (data/sql-scope.ts): a restricted
 * SQL subset where ?1 is always the tenant id and every table reference carries its own tenant_id = ?1 predicate.
 * bind() prepends the tenant id (the caller's first value is ?2) and returns an opaque statement.
 * Runtime encapsulation: state lives in #private fields (not reachable by casting), instances are frozen, and bound
 * statements can only be minted inside this module, so a raw D1PreparedStatement never leaves it and batch() only
 * accepts statements this module created for the same tenant.
 */
import { TenantScopeViolation, assertTenantScoped } from "./sql-scope";

export { TenantScopeViolation };

export type Param = string | number | null;

interface Entry {
  raw: D1PreparedStatement;
  tenantId: string;
}

const REGISTRY = new WeakMap<object, Entry>();
const MINT = Symbol("mint");

function unwrap(statement: unknown): Entry {
  const entry = typeof statement === "object" && statement !== null ? REGISTRY.get(statement) : undefined;
  if (!entry) throw new TenantScopeViolation("statement was not created by TenantDb");
  return entry;
}

/** A statement already bound to the tenant. Exposes execution only: no bind, no access to the raw statement. */
class BoundStatement {
  constructor(mint: unknown, raw: D1PreparedStatement, tenantId: string) {
    if (mint !== MINT) throw new TenantScopeViolation("statements are created by TenantDb only");
    REGISTRY.set(this, { raw, tenantId });
    Object.freeze(this);
  }

  run(): Promise<D1Response> {
    return unwrap(this).raw.run();
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return unwrap(this).raw.all<T>();
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return unwrap(this).raw.first<T>();
  }

  raw<T = unknown[]>(): Promise<T[]> {
    return unwrap(this).raw.raw<T>();
  }
}

export type TenantBoundStatement = BoundStatement;

export class TenantStatement {
  readonly #raw: D1PreparedStatement;
  readonly #tenantId: string;
  readonly #parameterCount: number;

  constructor(raw: D1PreparedStatement, tenantId: string, parameterCount: number) {
    this.#raw = raw;
    this.#tenantId = tenantId;
    this.#parameterCount = parameterCount;
    Object.freeze(this);
  }

  /** Binds ?2.. in order; ?1 is the tenant id and cannot be supplied. */
  bind(...rest: Param[]): TenantBoundStatement {
    if (rest.length + 1 !== this.#parameterCount) throw new TenantScopeViolation("parameter count does not match the SQL");
    return new BoundStatement(MINT, this.#raw.bind(this.#tenantId, ...rest), this.#tenantId);
  }
}

export class TenantDb {
  readonly #db: D1Database;
  readonly #tenantId: string;

  constructor(db: D1Database, tenantId: string) {
    this.#db = db;
    this.#tenantId = tenantId;
    Object.freeze(this);
  }

  get tenantId(): string {
    return this.#tenantId;
  }

  prepare(sql: string): TenantStatement {
    return new TenantStatement(this.#db.prepare(sql), this.#tenantId, assertTenantScoped(sql));
  }

  /** Accepts only statements created by a TenantDb bound to this same tenant. */
  async batch(statements: TenantBoundStatement[]): Promise<D1Result[]> {
    const raws = statements.map((statement) => {
      const entry = unwrap(statement);
      if (entry.tenantId !== this.#tenantId) throw new TenantScopeViolation("statement belongs to another tenant");
      return entry.raw;
    });
    return this.#db.batch(raws);
  }
}
