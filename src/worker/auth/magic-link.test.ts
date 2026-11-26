/**
 * Magic links on the admin router: request (generic answer, hashed single-use token, caps), verify (atomic consume,
 * expiry, tenant binding, session) and what ends up in the logs. All data is fictional (example.test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./sessions";
import { MAGIC_LINK_TTL_S, MAX_LINKS_PER_EMAIL } from "./magic-link";
import { sha256Hex } from "../ids";
import { TENANT_A, TENANT_B } from "../test/d1-cloud";
import { OWNER_A, adminCall, createHarness, type Harness } from "../test/harness";
import { magicKit, limiterOf, type MagicKit } from "../test/magic";

const NOW = Date.parse("2026-11-26T15:00:00.000Z");
const MEMBER = "owner-a@example.test";
const REQUEST = "/api/admin/magic-link";
const VERIFY = "/api/admin/magic-link/verify";

let h: Harness;
let kit: MagicKit;
let logs: string[];

beforeEach(() => {
  h = createHarness();
  kit = magicKit(h);
  logs = [];
  const capture = (line: unknown) => void logs.push(String(line));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => vi.restoreAllMocks());

const options = (extra: Record<string, unknown> = {}) => ({ session: false, magic: kit.deps, ip: "203.0.113.7", now: () => NOW, ...extra });

async function request(email: string, extra: Record<string, unknown> = {}) {
  const res = await adminCall(h.a, "POST", REQUEST, { email }, options(extra));
  await kit.settle();
  return res;
}

async function verify(token: string, extra: Record<string, unknown> = {}, rc = h.a) {
  return adminCall(rc, "POST", VERIFY, { token }, options(extra));
}

const snapshot = async (res: Response) => ({ status: res.status, body: await res.text(), setCookie: res.headers.get("set-cookie") });

describe("request: no account enumeration", () => {
  it("answers 200 and mails a member", async () => {
    const res = await request(MEMBER);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(kit.sender.sent).toHaveLength(1);
    expect(kit.sender.sent[0]?.to).toBe(MEMBER);
  });

  it("gives byte-identical answers for a member, an unknown address, another tenant's member and a synthetic user", async () => {
    const answers = [];
    for (const email of [MEMBER, "nadie@example.test", "owner-b@example.test", "owner@self-host.invalid"]) answers.push(await snapshot(await request(email)));
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(kit.sender.sent.map((m) => m.to)).toEqual([MEMBER]);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM magic_links").get()).toEqual({ n: 1 });
  });

  it("matches the address case-insensitively and ignores surrounding spaces", async () => {
    await request("  Owner-A@Example.TEST ");
    expect(kit.sender.sent).toHaveLength(1);
  });

  it("rejects only malformed addresses, with a message that says nothing about accounts", async () => {
    for (const email of ["", "sin-arroba", "a b@example.test", "x@example.test\r\nBcc: spy@example.test", `${"a".repeat(250)}@example.test`]) {
      const res = await request(email);
      expect(res.status).toBe(400);
    }
    expect((await adminCall(h.a, "POST", REQUEST, { email: 42 }, options())).status).toBe(400);
    expect(kit.sender.sent).toEqual([]);
  });
});

describe("request: token and link", () => {
  it("stores only the SHA-256 of a 256-bit token, bound to this tenant, valid for 15 minutes", async () => {
    await request(MEMBER);
    const token = kit.sender.lastToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = h.raw.sqlite.prepare("SELECT * FROM magic_links").all() as Array<Record<string, string | null>>;
    expect(rows).toEqual([
      {
        token_hash: await sha256Hex(new TextEncoder().encode(token)),
        tenant_id: TENANT_A,
        email: MEMBER,
        created_at: new Date(NOW).toISOString(),
        expires_at: new Date(NOW + MAGIC_LINK_TTL_S * 1000).toISOString(),
        consumed_at: null,
      },
    ]);
    expect(MAGIC_LINK_TTL_S).toBeLessThanOrEqual(15 * 60);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("links to the platform subdomain of the tenant when the request host has no live domain row", async () => {
    await request(MEMBER);
    const link = new URL(/https?:\/\/\S+/.exec(kit.sender.sent[0]?.text ?? "")?.[0] ?? "");
    expect(link.origin).toBe("https://demo-a.rekauda.test");
    expect(link.pathname).toBe("/admin");
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#acceso=${kit.sender.lastToken()}`);
  });

  describe("canonical link host", () => {
    const CUSTOM = "pagos.example.test";
    beforeEach(() => {
      h.raw.sqlite.prepare("INSERT INTO tenant_domains (hostname, tenant_id, kind, verified_at, created_at) VALUES (?, ?, 'custom', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z')").run(CUSTOM, TENANT_A);
    });

    it.each([
      ["a port", "https://pagos.example.test:8443"],
      ["a trailing dot", "https://pagos.example.test."],
      ["http", "http://pagos.example.test"],
      ["uppercase", "https://PAGOS.Example.TEST"],
    ])("always gives https://<canonical host> whatever the request has: %s", async (_name, base) => {
      await adminCall(h.a, "POST", REQUEST, { email: MEMBER }, options({ base }));
      await kit.settle();
      expect(kit.sender.sent[0]?.text).toContain(`https://${CUSTOM}/admin#acceso=${kit.sender.lastToken()}`);
    });

    it("ignores a custom domain that is not verified", async () => {
      h.raw.sqlite.prepare("UPDATE tenant_domains SET verified_at = NULL WHERE hostname = ?").run(CUSTOM);
      await adminCall(h.a, "POST", REQUEST, { email: MEMBER }, options({ base: `https://${CUSTOM}` }));
      await kit.settle();
      expect(kit.sender.sent[0]?.text).toContain("https://demo-a.rekauda.test/admin#acceso=");
    });

    it("uses http and the port only for local development hosts", async () => {
      await adminCall(h.a, "POST", REQUEST, { email: MEMBER }, options({ base: "http://demo-a.localhost:8787" }));
      await kit.settle();
      expect(kit.sender.sent[0]?.text).toContain("http://demo-a.localhost:8787/admin#acceso=");
    });
  });

  it("writes neutral Spanish copy without dashes as punctuation and without anything but the link", async () => {
    await request(MEMBER);
    const { subject, text } = kit.sender.sent[0] ?? { subject: "", text: "" };
    expect(subject).toBe("Tu enlace de acceso a Rekauda");
    expect(text).toMatch(/15 minutos/);
    expect(`${subject}${text}`).not.toMatch(/[–—]/);
    expect(`${subject}${text}`).not.toContain(MEMBER);
    expect(`${subject}${text}`).not.toMatch(/Demo|Torres|Andrade/);
  });

  it("gives every request a different token", async () => {
    await request(MEMBER);
    const first = kit.sender.lastToken();
    await request(MEMBER);
    expect(kit.sender.lastToken()).not.toBe(first);
  });
});

describe("request: limits", () => {
  it("sends at most 3 links per address in 15 minutes and still answers the same 200", async () => {
    const answers = [];
    for (let i = 0; i < MAX_LINKS_PER_EMAIL + 2; i++) answers.push(await snapshot(await request(MEMBER)));
    expect(MAX_LINKS_PER_EMAIL).toBe(3);
    expect(kit.sender.sent).toHaveLength(3);
    for (const a of answers) expect(a).toEqual(answers[0]);
  });

  it("frees the cap once the window has passed", async () => {
    for (let i = 0; i < 4; i++) await request(MEMBER);
    await request(MEMBER, { now: () => NOW + 15 * 60 * 1000 + 1000 });
    expect(kit.sender.sent).toHaveLength(4);
  });

  it("counts per tenant: a member of both tenants is capped separately", async () => {
    h.raw.sqlite.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'co_treasurer', '2026-11-26T00:00:00.000Z')").run(TENANT_B, OWNER_A);
    for (let i = 0; i < 4; i++) await request(MEMBER);
    const onB = await adminCall(h.b, "POST", REQUEST, { email: MEMBER }, options());
    await kit.settle();
    expect(onB.status).toBe(200);
    expect(kit.sender.sent).toHaveLength(4);
    expect(kit.sender.sent[3]?.text).toContain("https://demo-b.rekauda.test/admin#acceso=");
  });

  it("limits per tenant and client IP before reading the body", async () => {
    const keys: string[] = [];
    const limited = magicKit(h, limiterOf(keys, false));
    const res = await adminCall(h.a, "POST", REQUEST, undefined, options({ magic: limited.deps }));
    expect(res.status).toBe(429);
    expect(keys).toEqual([`ml:${TENANT_A}:203.0.113.7`]);
    expect(limited.sender.sent).toEqual([]);
  });
});

describe("request: availability and failures", () => {
  it("is 404 without a provider (not configured) and for self-host tenants", async () => {
    expect((await adminCall(h.a, "POST", REQUEST, { email: MEMBER }, options({ magic: null }))).status).toBe(404);
    const selfHost = { ...h.a, tenant: { ...h.a.tenant, source: "self_host" as const } };
    const login = { adminPassword: "x", limiter: limiterOf([]) };
    expect((await adminCall(selfHost, "POST", REQUEST, { email: MEMBER }, options({ login }))).status).toBe(404);
  });

  it("rejects a foreign Origin before doing anything", async () => {
    const res = await adminCall(h.a, "POST", REQUEST, { email: MEMBER }, options({ origin: "https://demo-b.rekauda.test" }));
    expect(res.status).toBe(403);
    expect(kit.sender.sent).toEqual([]);
  });

  it("answers the same 200 when the mail provider fails, and logs no address or token", async () => {
    kit.sender.failWith = new Error(`provider rejected ${MEMBER}`);
    const res = await request(MEMBER);
    expect(res.status).toBe(200);
    expect(logs.some((l) => l.includes("magic_link_send_failed"))).toBe(true);
    expect(logs.join("\n")).not.toContain(MEMBER);
  });

  it("retires the link when the mail cannot be sent, and frees its slot in the cap", async () => {
    kit.sender.failWith = new Error("provider down");
    for (let i = 0; i < 4; i++) await request(MEMBER);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM magic_links WHERE consumed_at = 'send_failed'").get()).toEqual({ n: 4 });
    kit.sender.failWith = null;
    await request(MEMBER);
    expect(kit.sender.sent).toHaveLength(1);
    expect((await verify(kit.sender.lastToken())).status).toBe(200);
  });

  it("never lets a failed-send link be used", async () => {
    let seen = "";
    kit.sender.send = async (m) => {
      seen = m.text;
      throw new Error("provider down");
    };
    await request(MEMBER);
    const token = /#acceso=([A-Za-z0-9_-]+)/.exec(seen)?.[1] ?? "";
    expect((await verify(token)).status).toBe(401);
  });

  it("logs neither the token nor the address when the provider error carries both", async () => {
    let token = "";
    kit.sender.send = async (m) => {
      token = /#acceso=([A-Za-z0-9_-]+)/.exec(m.text)?.[1] ?? "";
      throw new Error(`rejected ${m.to} for ${m.text}`);
    };
    await request(MEMBER);
    expect(token).toHaveLength(43);
    const out = logs.join("\n");
    expect(out).toContain("magic_link_send_failed");
    expect(out).not.toContain(MEMBER);
    expect(out).not.toContain(token);
  });

  it("survives a sender that throws synchronously", async () => {
    kit.sender.send = (() => {
      throw new Error("sync boom");
    }) as never;
    expect((await request(MEMBER)).status).toBe(200);
    expect(logs.some((l) => l.includes("magic_link_send_failed"))).toBe(true);
  });

  it("does the same work before answering for a member, an unknown address and a capped address", async () => {
    const run = async (email: string, rounds = 1) => {
      const sqlBefore = h.spy.statements.length;
      const callsBefore = kit.memberCalls.length;
      for (let i = 0; i < rounds; i++) await adminCall(h.a, "POST", REQUEST, { email }, options());
      return { sql: h.spy.statements.slice(sqlBefore).map((s) => s.sql), calls: kit.memberCalls.slice(callsBefore) };
    };
    const member = await run(MEMBER);
    await kit.settle();
    const unknown = await run("nadie@example.test");
    await kit.settle();
    expect(member).toEqual(unknown);
    expect(member.sql).toHaveLength(1);
    expect(member.calls).toEqual(["findMemberByEmail"]);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM magic_links").get()).toEqual({ n: 1 });
  });

  it("never logs addresses or tokens on the happy path", async () => {
    await request(MEMBER);
    await request("nadie@example.test");
    const token = kit.sender.lastToken();
    await verify(token);
    expect(logs.join("\n")).not.toMatch(/example\.test/);
    expect(logs.join("\n")).not.toContain(token);
  });

  it("keeps every statement tenant scoped", async () => {
    await request(MEMBER);
    await verify(kit.sender.lastToken());
    h.spy.assertAllScoped(TENANT_A);
  });
});

describe("verify", () => {
  async function issue(email = MEMBER): Promise<string> {
    await request(email);
    return kit.sender.lastToken();
  }

  it("consumes the link, sets the host-only session cookie and records the login", async () => {
    const token = await issue();
    const res = await verify(token, { now: () => NOW + 60_000 });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$`));
    expect(cookie).not.toMatch(/Domain/i);
    const session = await adminCall(h.a, "GET", "/api/admin/session", undefined, { cookie: cookie.split(";")[0] ?? "" });
    expect(await session.json()).toEqual({ ok: true, role: "owner" });
    expect(h.raw.sqlite.prepare("SELECT last_login_at FROM users WHERE id = ?").get(OWNER_A)).toEqual({ last_login_at: new Date(NOW + 60_000).toISOString() });
  });

  it("works exactly once", async () => {
    const token = await issue();
    expect((await verify(token)).status).toBe(200);
    const again = await verify(token);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "invalid_link" });
  });

  it("lets only one of two simultaneous attempts through", async () => {
    const token = await issue();
    const statuses = (await Promise.all([verify(token), verify(token)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 1 });
  });

  it("expires after 15 minutes", async () => {
    const token = await issue();
    expect((await verify(token, { now: () => NOW + MAGIC_LINK_TTL_S * 1000 })).status).toBe(401);
    const fresh = await issue();
    expect((await verify(fresh, { now: () => NOW + MAGIC_LINK_TTL_S * 1000 - 1000 })).status).toBe(200);
  });

  it("rejects a token issued for another tenant without consuming it", async () => {
    const token = await issue();
    expect((await verify(token, {}, h.b)).status).toBe(401);
    expect(h.raw.sqlite.prepare("SELECT consumed_at FROM magic_links WHERE tenant_id = ?").get(TENANT_A)).toEqual({ consumed_at: null });
    expect((await verify(token)).status).toBe(200);
  });

  it("answers every kind of bad token the same way", async () => {
    const used = await issue();
    await verify(used);
    const expired = await issue();
    const answers = [
      await snapshot(await verify(used)),
      await snapshot(await verify(expired, { now: () => NOW + 3_600_000 })),
      await snapshot(await verify(`${expired.slice(0, -1)}${expired.endsWith("A") ? "B" : "A"}`)),
      await snapshot(await verify("short")),
      await snapshot(await verify("")),
    ];
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(answers[0]?.status).toBe(401);
    expect(answers[0]?.setCookie).toBeNull();
  });

  it("fails when the address is no longer a member, leaving no session", async () => {
    const token = await issue();
    h.raw.sqlite.prepare("DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?").run(TENANT_A, OWNER_A);
    expect((await verify(token)).status).toBe(401);
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("does not revoke the member's other sessions (a link login proves nothing about older sessions)", async () => {
    const other = await adminCall(h.a, "GET", "/api/admin/session");
    expect(other.status).toBe(200);
    await verify(await issue());
    expect(h.raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 2 });
  });

  it("clears this tenant's expired links when verifying, and only this tenant's", async () => {
    const insert = h.raw.sqlite.prepare("INSERT INTO magic_links (token_hash, tenant_id, email, created_at, expires_at) VALUES (?, ?, 'x@example.test', '2026-11-26T00:00:00.000Z', ?)");
    insert.run("old-a", TENANT_A, "2026-11-26T14:00:00.000Z");
    insert.run("old-b", TENANT_B, "2026-11-26T14:00:00.000Z");
    insert.run("live-a", TENANT_A, "2026-11-26T16:00:00.000Z");
    await verify("x".repeat(43));
    const left = h.raw.sqlite.prepare("SELECT token_hash FROM magic_links ORDER BY token_hash").all();
    expect(left).toEqual([{ token_hash: "live-a" }, { token_hash: "old-b" }]);
  });

  it("limits attempts per tenant and IP with its own key, before parsing", async () => {
    const keys: string[] = [];
    const limited = magicKit(h, limiterOf(keys, false));
    const res = await adminCall(h.a, "POST", VERIFY, undefined, options({ magic: limited.deps }));
    expect(res.status).toBe(429);
    expect(keys).toEqual([`mlv:${TENANT_A}:203.0.113.7`]);
  });

  it("rejects a foreign Origin and is 404 without a provider", async () => {
    const token = await issue();
    expect((await verify(token, { origin: "https://evil.example.test" })).status).toBe(403);
    expect((await verify(token, { magic: null })).status).toBe(404);
    expect((await verify(token)).status).toBe(200);
  });
});
