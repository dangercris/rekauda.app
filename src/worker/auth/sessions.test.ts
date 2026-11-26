/** D1 sessions: hashed opaque token, tenant binding, fixed 7-day expiry (injected clock), revocation, cookie attributes. */
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../ids";
import { createHarness, type Harness } from "../test/harness";
import { TENANT_A, TENANT_B } from "../test/d1-cloud";
import { SESSION_COOKIE, SESSION_TTL_S, SessionStore, clearSessionCookie, sessionCookie } from "./sessions";

const USER_A = "u0000000-0000-4000-8000-00000000000a";
const USER_B = "u0000000-0000-4000-8000-00000000000b";
const T0 = Date.parse("2026-11-26T12:00:00.000Z");

let h: Harness;
let now: number;
const clock = () => now;
const storeOf = (rc: Harness["a"]) => new SessionStore(rc.db, clock);
const requestWith = (token: string, name = SESSION_COOKIE) => new Request("https://demo-a.localhost/api/admin/session", { headers: { cookie: `${name}=${token}` } });

beforeEach(() => {
  h = createHarness();
  now = T0;
});

describe("session tokens", () => {
  it("uses a random 256-bit token and stores only its SHA-256 hash", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = h.raw.sqlite.prepare("SELECT * FROM sessions").all() as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["token_hash"]).toBe(await sha256Hex(new TextEncoder().encode(token)));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT_A, user_id: USER_A, created_at: new Date(T0).toISOString() });
    expect(rows[0]?.["expires_at"]).toBe(new Date(T0 + SESSION_TTL_S * 1000).toISOString());
  });

  it("never issues the same token twice", async () => {
    const store = storeOf(h.a);
    expect((await store.create(USER_A)).token).not.toBe((await store.create(USER_A)).token);
  });

  it("refuses to create a session for a user without a membership in this tenant", async () => {
    await expect(storeOf(h.a).create(USER_B)).rejects.toThrow();
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });
});

describe("resolving a session", () => {
  it("returns the member and the role held in this tenant", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    expect(await storeOf(h.a).resolve(requestWith(token))).toEqual({ userId: USER_A, role: "owner" });
  });

  it("is bound to the tenant: A's cookie value is rejected on B even for a user who belongs to both", async () => {
    h.raw.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'co_treasurer', ?)").run(TENANT_B, USER_A, "2026-11-26T00:00:00.000Z");
    const { token } = await storeOf(h.a).create(USER_A);
    expect(await storeOf(h.b).resolve(requestWith(token))).toBeNull();
    expect(await storeOf(h.a).resolve(requestWith(token))).not.toBeNull();
  });

  it("rejects an expired session, exactly at the expiry instant and after it", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    now = T0 + SESSION_TTL_S * 1000 - 1;
    expect(await storeOf(h.a).resolve(requestWith(token))).not.toBeNull();
    now = T0 + SESSION_TTL_S * 1000;
    expect(await storeOf(h.a).resolve(requestWith(token))).toBeNull();
    now = T0 + SESSION_TTL_S * 1000 + 1;
    expect(await storeOf(h.a).resolve(requestWith(token))).toBeNull();
  });

  it("does not slide: using the session never extends its expiry", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    const before = h.raw.sqlite.prepare("SELECT expires_at FROM sessions").get();
    now = T0 + 3600_000;
    await storeOf(h.a).resolve(requestWith(token));
    expect(h.raw.sqlite.prepare("SELECT expires_at FROM sessions").get()).toEqual(before);
  });

  it("stops working when the membership is removed", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    h.raw.sqlite.prepare("DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?").run(TENANT_A, USER_A);
    expect(await storeOf(h.a).resolve(requestWith(token))).toBeNull();
  });

  it.each([
    ["an unknown token", "A".repeat(43)],
    ["a short value", "abc"],
    ["a value with illegal characters", `${"A".repeat(42)}'`],
    ["an oversized value", "A".repeat(500)],
  ])("rejects %s without touching the database for malformed values", async (_label, value) => {
    const before = h.spy.statements.length;
    expect(await storeOf(h.a).resolve(requestWith(value))).toBeNull();
    const malformed = !/^[A-Za-z0-9_-]{43}$/.test(value);
    if (malformed) expect(h.spy.statements.length).toBe(before);
  });

  it("ignores a cookie with another name (including the pre-cloud admin cookie) and a missing cookie", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    expect(await storeOf(h.a).resolve(requestWith(token, "rk_session"))).toBeNull();
    expect(await storeOf(h.a).resolve(requestWith(token, "adm"))).toBeNull();
    expect(await storeOf(h.a).resolve(new Request("https://demo-a.localhost/"))).toBeNull();
  });

  it("reads the session cookie among others", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    const request = new Request("https://demo-a.localhost/", { headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${token}; other=1` } });
    expect(await storeOf(h.a).resolve(request)).toEqual({ userId: USER_A, role: "owner" });
  });
});

describe("revocation", () => {
  it("deletes the row, so the same cookie no longer resolves", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    await storeOf(h.a).revoke(requestWith(token));
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(await storeOf(h.a).resolve(requestWith(token))).toBeNull();
  });

  it("cannot revoke another tenant's session", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    await storeOf(h.b).revoke(requestWith(token));
    expect(await storeOf(h.a).resolve(requestWith(token))).not.toBeNull();
  });

  it("is a no-op without a cookie", async () => {
    await expect(storeOf(h.a).revoke(new Request("https://demo-a.localhost/"))).resolves.toBeUndefined();
  });

  it("revokeOthers keeps the given session and drops the same user's others in this tenant only", async () => {
    h.raw.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'co_treasurer', ?)").run(TENANT_B, USER_A, "2026-11-26T00:00:00.000Z");
    const keep = await storeOf(h.a).create(USER_A);
    await storeOf(h.a).create(USER_A);
    const otherUser = await storeOf(h.b).create(USER_B);
    const sameUserOtherTenant = await storeOf(h.b).create(USER_A);
    await storeOf(h.a).revokeOthers(USER_A, keep.token);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ?").get(TENANT_A)).toEqual({ n: 1 });
    expect(await storeOf(h.a).resolve(requestWith(keep.token))).not.toBeNull();
    expect(await storeOf(h.b).resolve(requestWith(otherUser.token))).not.toBeNull();
    expect(await storeOf(h.b).resolve(requestWith(sameUserOtherTenant.token))).not.toBeNull();
    h.spy.assertAllScopedForAny([TENANT_A, TENANT_B]);
  });

  it("purges this tenant's expired rows when a new session is created, and only this tenant's", async () => {
    await storeOf(h.a).create(USER_A);
    await storeOf(h.b).create(USER_B);
    now = T0 + SESSION_TTL_S * 1000 + 1;
    await storeOf(h.a).create(USER_A);
    const rows = h.raw.sqlite.prepare("SELECT tenant_id FROM sessions ORDER BY tenant_id").all();
    expect(rows).toEqual([{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }]);
  });
});

describe("cookie", () => {
  it("is host-only: __Host- prefix, Path=/, HttpOnly, Secure, SameSite=Strict and no Domain", () => {
    expect(SESSION_COOKIE).toBe("__Host-rk_session");
    const cookie = sessionCookie("token-value", SESSION_TTL_S);
    expect(cookie).toBe(`__Host-rk_session=token-value; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`);
    expect(cookie).not.toMatch(/domain/i);
  });

  it("clears with Max-Age=0 and the same attributes", () => {
    expect(clearSessionCookie()).toBe("__Host-rk_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
  });

  it("lasts seven days", () => {
    expect(SESSION_TTL_S).toBe(7 * 24 * 60 * 60);
  });
});

describe("tenant scoping", () => {
  it("every statement is bound to the tenant of the store", async () => {
    const { token } = await storeOf(h.a).create(USER_A);
    await storeOf(h.a).resolve(requestWith(token));
    await storeOf(h.a).revoke(requestWith(token));
    h.spy.assertAllScoped(TENANT_A);
  });
});
