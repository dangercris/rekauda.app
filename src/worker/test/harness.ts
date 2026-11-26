/**
 * Two-tenant test harness: the seeded cloud database behind the SQL spy, a fake R2 bucket and one RequestContext per
 * tenant. Every handler test that goes through a RequestContext should end with spy.assertAllScoped(tenantId).
 */
import { timingSafeEqual } from "node:crypto";
import { adminRoute } from "../admin";
import { hmac, type AdminAuthConfig } from "../auth";
import { resolveInstance } from "../../shared/instance";
import { parseInstanceConfig } from "../../shared/instance-validation";
import { buildContext, type RequestContext } from "../context";
import type { Tenant } from "../tenancy/tenant";
import { asD1, type TestDb } from "./d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./d1-cloud";
import { FakeBucket, asR2 } from "./r2-fake";
import { spyOnDb } from "./sql-spy";

export const COLLECTION_A = "c0000000-0000-4000-8000-00000000000a";
export const COLLECTION_B = "c0000000-0000-4000-8000-00000000000b";
/** Both tenants use these on purpose: slug, payment code and transaction number collide across tenants. */
export const SHARED_SLUG = "demo-collection";
export const SHARED_CODE = "AAA-AAA";
export const SHARED_TRANSACTION = "900000000001";

export const tenantOf = (id: string, slug: string): Tenant => ({ id, slug, r2Prefix: `t/${id}/`, source: "cloud" });

export function createHarness() {
  const raw = createCloudTestDb({ seed: true });
  const spy = spyOnDb(raw);
  const bucket = new FakeBucket();
  const bindings = { db: asD1(spy.db), files: asR2(bucket) };
  // Each tenant's config is its seeded config_json, parsed with the same rules the D1ConfigStore applies.
  const configOf = (id: string) => {
    const row = raw.sqlite.prepare("SELECT config_json FROM tenants WHERE id = ?").get(id) as { config_json: string };
    return resolveInstance(parseInstanceConfig(JSON.parse(row.config_json), "test tenant"));
  };
  const a = buildContext(tenantOf(TENANT_A, "demo-a"), bindings, configOf(TENANT_A));
  const b = buildContext(tenantOf(TENANT_B, "demo-b"), bindings, configOf(TENANT_B));
  return { raw, spy, bucket, a, b };
}

export type Harness = ReturnType<typeof createHarness>;

let seq = 0;

export interface SeedPaymentInput {
  id?: string;
  code?: string;
  parentName?: string;
  amountCents?: number;
  status?: "en_revision" | "recibido" | "observado" | "pagado" | "anulado";
  createdAt?: string;
  surnames?: string[];
  transferDate?: string;
  bank?: string;
  receiptKey?: string;
}

/** Inserts a payment with one student per surname into the tenant's seeded collection. Writes through the raw double. */
export function seedPaymentFor(db: TestDb, tenantId: string, input: SeedPaymentInput = {}): { id: string; receiptKey: string } {
  seq += 1;
  const id = input.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const collectionId = tenantId === TENANT_A ? COLLECTION_A : COLLECTION_B;
  const receiptKey = input.receiptKey ?? `t/${tenantId}/receipts/${id}.png`;
  db.sqlite
    .prepare(
      `INSERT INTO payments (id, tenant_id, code, parent_name, phone, amount_cents, expected_cents, transfer_date, bank, reference, receipt_key,
         receipt_type, receipt_size, receipt_sha256, collection_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '+593990000000', ?, ?, ?, ?, NULL, ?, 'image/png', 10, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      tenantId,
      input.code ?? `T${String(seq).padStart(2, "0")}-AAA`,
      input.parentName ?? "Carolina Vasquez",
      input.amountCents ?? 1400,
      input.amountCents ?? 1400,
      input.transferDate ?? "2026-11-26",
      input.bank ?? "Cooperativa Demo",
      receiptKey,
      `sha-${id}`,
      collectionId,
      input.status ?? "en_revision",
      createdAt,
      createdAt,
    );
  for (const surnames of input.surnames ?? ["Andrade"]) {
    db.sqlite
      .prepare("INSERT INTO students (tenant_id, payment_id, given_names, surnames, option_key, option_cents) VALUES (?, ?, 'Mateo', ?, 'standard', 1400)")
      .run(tenantId, id, surnames);
  }
  return { id, receiptKey };
}

export function seedMovementFor(db: TestDb, tenantId: string, transactionNumber = SHARED_TRANSACTION, amountCents = 1400): string {
  seq += 1;
  const id = `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  db.sqlite
    .prepare(
      `INSERT INTO bank_movements (id, tenant_id, transaction_number, amount_cents, received_at, payer_name, created_at)
       VALUES (?, ?, ?, ?, '2026-11-26T14:02:00.000Z', 'Torres Mendez Lucia Ana', '2026-11-26T15:00:00.000Z')`,
    )
    .run(id, tenantId, transactionNumber, amountCents);
  return id;
}

export type { RequestContext };

// ---------------------------------------------------------------- admin calls

// Workers expose crypto.subtle.timingSafeEqual, Node does not.
if (!("timingSafeEqual" in crypto.subtle)) {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(new Uint8Array(a), new Uint8Array(b)),
  });
}

export const ORIGIN = "https://rekauda.test";
export const ADMIN_AUTH: AdminAuthConfig = {
  adminPassword: "pw",
  sessionSecret: "test-session-secret",
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  loginLimiter: { limit: async () => ({ success: true }) } as unknown as RateLimit,
};

export async function adminCookie(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 600;
  return `adm=${exp}.${await hmac(ADMIN_AUTH.sessionSecret, `adm:${exp}`)}`;
}

/** Calls the admin router for one tenant context. HttpErrors come back as `{ error }` responses, like in index.ts. */
export async function adminCall(
  rc: RequestContext,
  method: string,
  path: string,
  body?: unknown,
  options: { session?: boolean; origin?: string | null; auth?: AdminAuthConfig | null } = {},
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.session !== false) headers.set("cookie", await adminCookie());
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  const request = new Request(`${ORIGIN}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const auth = options.auth === undefined ? ADMIN_AUTH : options.auth;
  try {
    return await adminRoute(request, rc, auth, new URL(request.url));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (typeof status === "number") return Response.json({ error: (e as { code?: string }).code }, { status });
    throw e;
  }
}
