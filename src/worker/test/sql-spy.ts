/**
 * SQL spy for isolation tests. It records every statement that reaches the database and asserts, per statement, that
 * ?1 is the current tenant and that the SQL passes the shared scope checker (data/sql-scope.ts), the same one TenantDb uses.
 * Wrap the test DB, build the TenantDb over spy.db, run the flow, then call spy.assertAllScoped(tenantId).
 */
import { assertTenantScoped } from "../data/sql-scope";
import type { TestDb } from "./d1";

type Param = string | number | null;
export interface RecordedStatement {
  sql: string;
  params: Param[];
}

/** Records every statement when it EXECUTES (run/all/first or inside batch), not when it is bound. */
export function spyOnDb(real: TestDb) {
  const statements: RecordedStatement[] = [];
  const record = (sql: string, params: Param[]): void => void statements.push({ sql, params });
  type Inner = ReturnType<TestDb["prepare"]>;
  const bound = (sql: string, params: Param[], inner: Inner) => ({
    sql,
    params,
    inner,
    runSync: () => (record(sql, params), inner.runSync()),
    run: () => (record(sql, params), inner.run()),
    all: <T>() => (record(sql, params), inner.all<T>()),
    first: <T>() => (record(sql, params), inner.first<T>()),
  });
  const wrapper = {
    batch: (batch: Array<ReturnType<typeof bound>>) => {
      for (const statement of batch) if (!("inner" in statement)) throw new Error("batch received a statement the spy did not create");
      return real.batch(batch.map((statement) => ({ ...statement.inner, runSync: statement.runSync }) as unknown as Inner));
    },
    prepare: (sql: string) => {
      const inner = real.prepare(sql);
      return { ...bound(sql, [], inner), bind: (...params: Param[]) => bound(sql, params, inner.bind(...params)) };
    },
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    db: wrapper as unknown as TestDb,
    statements,
    assertAllScoped(tenantId: string): void {
      if (statements.length === 0) throw new Error("no statements were recorded");
      for (const { sql, params } of statements) {
        if (params.length === 0) throw new Error(`statement executed without binding the tenant id: ${sql}`);
        if (params[0] !== tenantId) throw new Error(`statement bound to another tenant: ${sql}`);
        assertTenantScoped(sql);
      }
    },
    /** For tests that act as several tenants: every statement is bound to one of them and passes the scope checker. */
    assertAllScopedForAny(tenantIds: string[]): void {
      if (statements.length === 0) throw new Error("no statements were recorded");
      for (const { sql, params } of statements) {
        if (typeof params[0] !== "string" || !tenantIds.includes(params[0])) throw new Error(`statement bound to an unexpected tenant: ${sql}`);
        assertTenantScoped(sql);
      }
    },
  };
}
