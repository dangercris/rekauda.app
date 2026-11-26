/**
 * Admin gating on D1 sessions: every admin route needs a session of THIS tenant with a membership role, mutations keep
 * the Origin check, logout revokes, and the self-host password provider opens a session for the synthetic owner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResponse } from "../shared/api";
import { adminRoute } from "./admin";
import type { PasswordLogin } from "./auth/password";
import { SESSION_COOKIE, SESSION_TTL_S, SessionStore } from "./auth/sessions";
import { buildContext, type RequestContext } from "./context";
import { PlatformDb, SELF_HOST_OWNER_ID, SELF_HOST_TENANT_ID } from "./data/platform-db";
import { sha256Hex } from "./ids";
import { asD1 } from "./test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./test/d1-cloud";
import { ORIGIN, OWNER_A, adminCall, adminCookie, createHarness, seedPaymentFor, type Harness } from "./test/harness";
import { FakeBucket, asR2 } from "./test/r2-fake";

let h: Harness;
let logs: string[];
const CO_TREASURER = "u0000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  h = createHarness();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void logs.push(String(line)));
});
afterEach(() => vi.restoreAllMocks());

const ADMIN_ROUTES: Array<[string, string]> = [
  ["GET", "/api/admin/session"],
  ["GET", "/api/admin/payments"],
  ["GET", "/api/admin/collections"],
  ["GET", "/api/admin/movements"],
  ["POST", "/api/admin/collections"],
  ["GET", "/api/admin/receipts/00000000-0000-4000-8000-000000000001"],
  ["POST", "/api/admin/movements/00000000-0000-4000-8000-000000000001/link"],
  ["POST", "/api/admin/collections/00000000-0000-4000-8000-000000000001/cover"],
  ["POST", "/api/admin/movements/import"],
  ["POST", `/api/admin/payments/00000000-0000-4000-8000-000000000001/status`],
];

describe("every admin route requires a session", () => {
  it.each(ADMIN_ROUTES)("%s %s answers 401 without a cookie", async (method, path) => {
    expect((await adminCall(h.a, method, path, {}, { session: false })).status).toBe(401);
  });

  it.each(ADMIN_ROUTES)("%s %s answers 401 with a forged cookie", async (method, path) => {
    expect((await adminCall(h.a, method, path, {}, { cookie: `${SESSION_COOKIE}=${"A".repeat(43)}` })).status).toBe(401);
  });

  it("answers 401 (not 503) in a tenant without any password provider", async () => {
    expect((await adminCall(h.a, "GET", "/api/admin/session", undefined, { session: false })).status).toBe(401);
  });
});

describe("session endpoint", () => {
  it("returns the role held in this tenant", async () => {
    const res = await adminCall(h.a, "GET", "/api/admin/session");
    expect(res.status).toBe(200);
    expect((await res.json()) as AdminSessionResponse).toEqual({ ok: true, role: "owner" });
  });

  it("rejects a revoked session and an expired one", async () => {
    const cookie = await adminCookie(h.a);
    await h.raw.sqlite.prepare("DELETE FROM sessions").run();
    expect((await adminCall(h.a, "GET", "/api/admin/session", undefined, { cookie })).status).toBe(401);

    const old = new SessionStore(h.a.db, () => Date.now() - (SESSION_TTL_S + 1) * 1000);
    const { token } = await old.create(OWNER_A);
    expect((await adminCall(h.a, "GET", "/api/admin/session", undefined, { cookie: `${SESSION_COOKIE}=${token}` })).status).toBe(401);
  });
});

describe("cross-tenant", () => {
  it("rejects A's session on B's admin even when the cookie value is replayed by hand", async () => {
    const cookie = await adminCookie(h.a);
    expect((await adminCall(h.a, "GET", "/api/admin/payments", undefined, { cookie })).status).toBe(200);
    for (const [method, path] of ADMIN_ROUTES) expect((await adminCall(h.b, method, path, {}, { cookie })).status).toBe(401);
  });

  it("keeps a co-treasurer of A out of B, even with B's payment id", async () => {
    h.raw.sqlite.prepare("INSERT INTO users (id, email, kind, created_at) VALUES (?, 'co-a@example.test', 'person', ?)").run(CO_TREASURER, "2026-11-26T00:00:00.000Z");
    h.raw.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'co_treasurer', ?)").run(TENANT_A, CO_TREASURER, "2026-11-26T00:00:00.000Z");
    const cookie = await adminCookie(h.a, CO_TREASURER);
    const paymentB = seedPaymentFor(h.raw, TENANT_B);
    const res = await adminCall(h.b, "POST", `/api/admin/payments/${paymentB.id}/status`, { status: "pagado" }, { cookie });
    expect(res.status).toBe(401);
    expect(h.raw.sqlite.prepare("SELECT status FROM payments WHERE id = ?").get(paymentB.id)).toEqual({ status: "en_revision" });
  });
});

describe("roles", () => {
  it.each([
    ["owner", OWNER_A],
    ["co_treasurer", CO_TREASURER],
  ])("lets a %s mark a payment pagado and anulado", async (role, userId) => {
    if (userId === CO_TREASURER) {
      h.raw.sqlite.prepare("INSERT INTO users (id, email, kind, created_at) VALUES (?, 'co-a@example.test', 'person', ?)").run(userId, "2026-11-26T00:00:00.000Z");
      h.raw.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run(TENANT_A, userId, role, "2026-11-26T00:00:00.000Z");
    }
    const cookie = await adminCookie(h.a, userId);
    expect(((await (await adminCall(h.a, "GET", "/api/admin/session", undefined, { cookie })).json()) as AdminSessionResponse).role).toBe(role);
    const payment = seedPaymentFor(h.raw, TENANT_A);
    expect((await adminCall(h.a, "POST", `/api/admin/payments/${payment.id}/status`, { status: "pagado" }, { cookie })).status).toBe(200);
    expect(h.raw.sqlite.prepare("SELECT reviewed_by FROM payments WHERE id = ?").get(payment.id)).toEqual({ reviewed_by: userId });
    expect((await adminCall(h.a, "POST", `/api/admin/payments/${payment.id}/status`, { status: "anulado", note: "Duplicado" }, { cookie })).status).toBe(200);
  });
});

describe("receipts", () => {
  it("are never cached: private, no-store", async () => {
    const payment = seedPaymentFor(h.raw, TENANT_A);
    await h.bucket.put(payment.receiptKey, "receipt-a");
    const res = await adminCall(h.a, "GET", `/api/admin/receipts/${payment.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("Origin check on every mutation", () => {
  it.each([
    ["/api/admin/login", { password: "pw" }],
    ["/api/admin/logout", {}],
    ["/api/admin/collections", {}],
    ["/api/admin/payments/00000000-0000-4000-8000-000000000001/status", { status: "pagado" }],
  ])("POST %s with a foreign Origin answers 403 before anything else", async (path, body) => {
    const login: PasswordLogin = { adminPassword: "pw", limiter: limiterOf([]) };
    for (const origin of ["https://evil.example", null]) {
      expect((await adminCall(h.a, "POST", path, body, { origin, login, session: false })).status).toBe(403);
    }
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("does not require Origin on safe methods", async () => {
    expect((await adminCall(h.a, "GET", "/api/admin/session", undefined, { origin: null })).status).toBe(200);
  });
});

describe("logout", () => {
  it("deletes the session row, clears the cookie and invalidates the cookie value", async () => {
    const cookie = await adminCookie(h.a);
    const res = await adminCall(h.a, "POST", "/api/admin/logout", {}, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect((await adminCall(h.a, "GET", "/api/admin/session", undefined, { cookie })).status).toBe(401);
  });

  it("is idempotent without a session and cannot revoke another tenant's session", async () => {
    expect((await adminCall(h.a, "POST", "/api/admin/logout", {}, { session: false })).status).toBe(200);
    const cookie = await adminCookie(h.a);
    await adminCall(h.b, "POST", "/api/admin/logout", {}, { cookie });
    expect((await adminCall(h.a, "GET", "/api/admin/session", undefined, { cookie })).status).toBe(200);
  });
});

function limiterOf(keys: string[], success = true): RateLimit {
  return { limit: async ({ key }: { key: string }) => (keys.push(key), { success }) } as unknown as RateLimit;
}

/** A self-host tenant, provisioned like the composition root does it, on an unseeded database. */
async function selfHost(): Promise<{ rc: RequestContext; raw: ReturnType<typeof createCloudTestDb> }> {
  const raw = createCloudTestDb();
  const platform = new PlatformDb(asD1(raw));
  await platform.provisionSelfHostTenant("2026-11-26T00:00:00.000Z");
  const tenant = await platform.findSelfHostTenant();
  if (!tenant) throw new Error("self-host tenant missing");
  return { rc: buildContext(tenant, { db: asD1(raw), files: asR2(new FakeBucket()) }, h.a.config), raw };
}

const loginRequest = (password: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ password }),
  });

describe("self-host password provider", () => {
  it("opens a D1 session for the synthetic owner, stored hashed, with the host-only cookie", async () => {
    const { rc, raw } = await selfHost();
    const keys: string[] = [];
    const login: PasswordLogin = { adminPassword: "clave-local", limiter: limiterOf(keys) };
    const res = await adminRoute(loginRequest("clave-local"), rc, login, new URL(`${ORIGIN}/api/admin/login`));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}$`));
    const token = /=([^;]+)/.exec(cookie)?.[1] ?? "";
    const rows = raw.sqlite.prepare("SELECT tenant_id, user_id, token_hash FROM sessions").all();
    expect(rows).toEqual([{ tenant_id: SELF_HOST_TENANT_ID, user_id: SELF_HOST_OWNER_ID, token_hash: await sha256Hex(new TextEncoder().encode(token)) }]);
    expect(keys).toEqual([`login:${SELF_HOST_TENANT_ID}:203.0.113.7`]);

    const session = await adminRoute(
      new Request(`${ORIGIN}/api/admin/session`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
      rc,
      login,
      new URL(`${ORIGIN}/api/admin/session`),
    );
    expect(((await session.json()) as AdminSessionResponse).role).toBe("owner");
  });

  it("rejects a wrong password with 401, no cookie, no session row and no secret in the logs", async () => {
    const { rc, raw } = await selfHost();
    const login: PasswordLogin = { adminPassword: "clave-local", limiter: limiterOf([]) };
    await expect(adminRoute(loginRequest("clave-equivocada"), rc, login, new URL(`${ORIGIN}/api/admin/login`))).rejects.toMatchObject({ status: 401 });
    for (const bad of [undefined, "", 42, null]) {
      await expect(adminRoute(loginRequest(bad), rc, login, new URL(`${ORIGIN}/api/admin/login`))).rejects.toMatchObject({ status: 401 });
    }
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(logs.join("\n")).not.toMatch(/clave/);
  });

  it("rate limits before comparing: a refused attempt is 429 even with the right password", async () => {
    const { rc, raw } = await selfHost();
    const login: PasswordLogin = { adminPassword: "clave-local", limiter: limiterOf([], false) };
    await expect(adminRoute(loginRequest("clave-local"), rc, login, new URL(`${ORIGIN}/api/admin/login`))).rejects.toMatchObject({ status: 429 });
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("answers 429 for a rate limited login even when the body is not JSON (limiter runs before parsing)", async () => {
    const { rc } = await selfHost();
    const login: PasswordLogin = { adminPassword: "clave-local", limiter: limiterOf([], false) };
    const request = new Request(`${ORIGIN}/api/admin/login`, { method: "POST", headers: { "content-type": "text/plain", origin: ORIGIN }, body: "not json" });
    await expect(adminRoute(request, rc, login, new URL(request.url))).rejects.toMatchObject({ status: 429 });
  });

  it("a successful login revokes every older session of the synthetic owner (password rotation)", async () => {
    const { rc, raw } = await selfHost();
    const store = new SessionStore(rc.db);
    const older = [(await store.create(SELF_HOST_OWNER_ID)).token, (await store.create(SELF_HOST_OWNER_ID)).token];
    const login: PasswordLogin = { adminPassword: "nueva-clave", limiter: limiterOf([]) };
    const res = await adminRoute(loginRequest("nueva-clave"), rc, login, new URL(`${ORIGIN}/api/admin/login`));
    const fresh = /=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 1 });
    const resolves = async (token: string) => (await store.resolve(new Request(ORIGIN, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))) !== null;
    expect(await resolves(fresh)).toBe(true);
    for (const token of older) expect(await resolves(token)).toBe(false);
  });

  it("a failed login revokes nothing", async () => {
    const { rc, raw } = await selfHost();
    await new SessionStore(rc.db).create(SELF_HOST_OWNER_ID);
    const login: PasswordLogin = { adminPassword: "clave-local", limiter: limiterOf([]) };
    await expect(adminRoute(loginRequest("mala"), rc, login, new URL(`${ORIGIN}/api/admin/login`))).rejects.toMatchObject({ status: 401 });
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 1 });
  });

  it("answers 503 admin_disabled when the instance has no ADMIN_PASSWORD", async () => {
    const { rc } = await selfHost();
    await expect(adminRoute(loginRequest("x"), rc, null, new URL(`${ORIGIN}/api/admin/login`))).rejects.toMatchObject({ status: 503, code: "admin_disabled" });
  });

  it("is not available to a cloud tenant even if a password provider is wired by mistake", async () => {
    const login: PasswordLogin = { adminPassword: "clave-local", limiter: limiterOf([]) };
    const res = await adminCall(h.a, "POST", "/api/admin/login", { password: "clave-local" }, { login, session: false });
    expect(res.status).toBe(404);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("is not available in a cloud tenant without a provider either (login is 404, never 503)", async () => {
    expect((await adminCall(h.b, "POST", "/api/admin/login", { password: "x" }, { session: false })).status).toBe(404);
  });
});
