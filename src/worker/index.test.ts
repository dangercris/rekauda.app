/**
 * Composition root: tenant resolution from the Host header, generic 404s, client-supplied tenants ignored, the
 * unknown-host read guard, admin disabled in multi mode and the email() entry point. og-image (WASM renderer) is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SessionStore } from "./auth/sessions";
import { TenantDb } from "./data/tenant-db";
import type { CloudEnv } from "./env";
import worker from "./index";
import { resetTenancyState } from "./tenancy/runtime";
import { asD1, type TestDb } from "./test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./test/d1-cloud";
import { FakeBucket, asR2 } from "./test/r2-fake";
import { generateKey, signMessage } from "./test/sign";
import { SELF_HOST_TENANT_ID } from "./data/platform-db";

vi.mock("./og-image", () => ({ serveOgImage: async () => new Response("og-stub") }));

const ec = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

interface Setup {
  raw: TestDb;
  bucket: FakeBucket;
  lookups: string[];
  assetCalls: string[];
  limiterKeys: string[];
}

function limiter(keys: string[], success = true): RateLimit {
  return {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success };
    },
  } as unknown as RateLimit;
}

function setup(mode: "multi" | "single", options: { seed?: boolean; limitOk?: boolean; failTenantReads?: boolean; failConfigReads?: boolean } = {}): Setup & { env: CloudEnv } {
  const raw = createCloudTestDb({ seed: options.seed ?? mode === "multi" });
  const bucket = new FakeBucket();
  const lookups: string[] = [];
  const assetCalls: string[] = [];
  const limiterKeys: string[] = [];
  const db = {
    prepare: (sql: string) => {
      if (sql.includes("tenant_domains")) lookups.push(sql);
      if (options.failConfigReads && sql.includes("config_json")) throw new Error("D1 unavailable");
      if (options.failTenantReads && /FROM tenants|INTO tenants/.test(sql)) throw new Error("D1 unavailable");
      return raw.prepare(sql);
    },
    batch: (statements: Parameters<TestDb["batch"]>[0]) => raw.batch(statements),
  };
  const common = {
    DB: asD1(db as unknown as TestDb),
    RECEIPTS: asR2(bucket),
    ASSETS: { fetch: async (request: Request) => (assetCalls.push(new URL(request.url).pathname), new Response("asset")) },
    IMAGES: {},
    SUBMIT_LIMITER: limiter(limiterKeys),
    LOGIN_LIMITER: limiter(limiterKeys),
    LOOKUP_LIMITER: limiter(limiterKeys, options.limitOk ?? true),
  };
  const env =
    mode === "multi"
      ? { ...common, TENANCY: "multi", ROOT_DOMAIN: "localhost", INBOUND_DOMAIN: "in.localhost", MAIL_ARCHIVE: asR2(new FakeBucket()), SEND_EMAIL: {} }
      : { ...common, TENANCY: "single", ADMIN_PASSWORD: "pw", FORWARD_TO: "treasurer@example.test" };
  return { raw, bucket, lookups, assetCalls, limiterKeys, env: env as unknown as CloudEnv };
}

const get = (env: CloudEnv, host: string, path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://${host}${path}`, { headers: { "cf-connecting-ip": "203.0.113.1", ...headers } }), env, ec);

/** A cloud session cookie for `owner` of `tenantId`, created straight in the database. */
async function cloudCookie(raw: TestDb, tenantId: string, owner: string): Promise<string> {
  const { token } = await new SessionStore(new TenantDb(asD1(raw), tenantId)).create(owner);
  return `${SESSION_COOKIE}=${token}`;
}
const OWNER_A = "u0000000-0000-4000-8000-00000000000a";

/** Logs in to a single-mode instance through the Worker and returns the session cookie it set. */
async function singleCookie(env: CloudEnv, host: string): Promise<string> {
  const res = await worker.fetch(
    new Request(`https://${host}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `https://${host}`, "cf-connecting-ip": "203.0.113.1" },
      body: JSON.stringify({ password: "pw" }),
    }),
    env,
    ec,
  );
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

beforeEach(() => {
  resetTenancyState();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("multi mode tenant resolution", () => {
  it("serves each host its own tenant's data", async () => {
    const { env } = setup("multi");
    const titles = async (host: string) => ((await (await get(env, host, "/api/collections")).json()) as { collections: Array<{ title: string }> }).collections.map((c) => c.title);
    expect(await titles("demo-a.localhost")).toEqual(["Demo collection A"]);
    expect(await titles("demo-b.localhost:8799")).toEqual(["Demo collection B"]);
  });

  it("ignores a tenant id supplied in the query, a header or the cookie", async () => {
    const { env } = setup("multi");
    const res = await get(env, "demo-b.localhost", `/api/collections?tenant=${TENANT_A}&tenant_id=${TENANT_A}`, {
      "x-tenant-id": TENANT_A,
      "x-tenant": "demo-a",
      cookie: `tenant=${TENANT_A}`,
    });
    const body = (await res.json()) as { collections: Array<{ title: string }> };
    expect(body.collections.map((c) => c.title)).toEqual(["Demo collection B"]);
  });

  it("answers an identical generic 404 for unknown, reserved, apex, malformed and suspended hosts, for pages and assets too", async () => {
    const { env, raw, assetCalls } = setup("multi");
    raw.sqlite.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(TENANT_B);
    const bodies = new Set<string>();
    for (const host of ["nobody.localhost", "admin.localhost", "localhost", "www.localhost", "a.b.localhost", "demo-b.localhost", "evil.example"]) {
      for (const path of ["/api/collections", "/", "/admin", "/r/demo-collection"]) {
        const res = await get(env, host, path);
        expect(res.status).toBe(404);
        bodies.add(await res.text());
      }
    }
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).not.toMatch(/demo|tenant|slug/i);
    expect(assetCalls).toEqual([]);
  });

  it("serves static assets and pages for a resolved host", async () => {
    const { env, assetCalls } = setup("multi");
    expect(await (await get(env, "demo-a.localhost", "/assets/app.js")).text()).toBe("asset");
    expect(assetCalls).toEqual(["/assets/app.js"]);
  });

  it("rate limits uncached host lookups per client and never reads the database once refused", async () => {
    const { env, lookups, limiterKeys } = setup("multi", { limitOk: false });
    const res = await worker.fetch(new Request("https://nobody.localhost/api/collections", { headers: { "cf-connecting-ip": "203.0.113.9" } }), env, ec);
    expect(res.status).toBe(429);
    expect(lookups).toEqual([]);
    expect(limiterKeys).toEqual(["host-miss:203.0.113.9"]);
  });

  it("does not spend the limiter or the database on hosts that fail parsing, nor on cached hosts", async () => {
    const { env, lookups, limiterKeys } = setup("multi");
    for (const host of ["admin.localhost", "localhost", "bad_host.localhost"]) await get(env, host, "/api/collections");
    expect([lookups.length, limiterKeys.length]).toEqual([0, 0]);
    await get(env, "demo-a.localhost", "/api/collections");
    await get(env, "demo-a.localhost", "/api/collections");
    expect([lookups.length, limiterKeys.length]).toEqual([1, 1]);
  });
});

describe("admin in multi mode", () => {
  const adminGet = (env: CloudEnv, host: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://${host}/api/admin/payments`, { headers: { "cf-connecting-ip": "203.0.113.1", ...headers } }), env, ec);

  it("answers 401, not 503, without a session even when a password secret exists, and offers no password login", async () => {
    const { env } = setup("multi");
    const withSecrets = { ...env, ADMIN_PASSWORD: "pw" } as unknown as CloudEnv;
    expect((await adminGet(withSecrets, "demo-a.localhost")).status).toBe(401);
    const login = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://demo-a.localhost", "cf-connecting-ip": "203.0.113.1" },
        body: JSON.stringify({ password: "pw" }),
      }),
      withSecrets,
      ec,
    );
    expect(login.status).toBe(404);
  });

  it("sends magic links through the send_email binding after answering, from the root domain to the tenant's own host", async () => {
    const { env } = setup("multi");
    const sent: Array<Record<string, unknown>> = [];
    const work: Promise<unknown>[] = [];
    const multi = { ...env, SEND_EMAIL: { send: async (m: Record<string, unknown>) => void sent.push(m) } } as unknown as CloudEnv;
    const context = { waitUntil: (p: Promise<unknown>) => void work.push(p), passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://demo-a.localhost", "cf-connecting-ip": "203.0.113.1" },
        body: JSON.stringify({ email: "owner-a@example.test" }),
      }),
      multi,
      context,
    );
    await Promise.all(work);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: { email: "no-reply@localhost" }, to: "owner-a@example.test" });
    expect(String(sent[0]?.["text"])).toContain("http://demo-a.localhost/admin#acceso=");
  });

  it("offers no magic link, and logs why, when the SEND_EMAIL binding is missing", async () => {
    const { env } = setup("multi");
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void logs.push(String(line)));
    const unbound = { ...env, SEND_EMAIL: undefined } as unknown as CloudEnv;
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://demo-a.localhost", "cf-connecting-ip": "203.0.113.1" },
        body: JSON.stringify({ email: "owner-a@example.test" }),
      }),
      unbound,
      ec,
    );
    expect(res.status).toBe(404);
    expect(logs.some((l) => l.includes("magic_link_not_configured"))).toBe(true);
  });

  it("offers no magic link in single mode", async () => {
    const { env } = setup("single");
    const res = await worker.fetch(
      new Request("https://anything.example.test/api/admin/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://anything.example.test", "cf-connecting-ip": "203.0.113.1" },
        body: JSON.stringify({ email: "owner-a@example.test" }),
      }),
      env,
      ec,
    );
    expect(res.status).toBe(404);
  });

  it("accepts a session of the host's tenant and rejects the same cookie value on another tenant's host", async () => {
    const { env, raw } = setup("multi");
    const cookie = await cloudCookie(raw, TENANT_A, OWNER_A);
    expect((await adminGet(env, "demo-a.localhost", { cookie })).status).toBe(200);
    expect((await adminGet(env, "demo-b.localhost", { cookie })).status).toBe(401);
  });

  it("the admin .eml import needs a session in multi mode", async () => {
    const { env } = setup("multi");
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/movements/import", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1", origin: "https://demo-a.localhost" } }),
      env,
      ec,
    );
    expect(res.status).toBe(401);
  });

  it("refuses a mutation with a foreign Origin before checking the session", async () => {
    const { env } = setup("multi");
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/logout", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1", origin: "https://demo-b.localhost" } }),
      env,
      ec,
    );
    expect(res.status).toBe(403);
  });
});

describe("single mode (self-host)", () => {
  it("maps any host to the seeded tenant", async () => {
    const { env, raw } = setup("single");
    const insert = raw.sqlite.prepare(
      `INSERT INTO collections (id, tenant_id, slug, title, description, options_json, deadline, created_at, updated_at)
       VALUES ('c0000000-0000-4000-8000-0000000000f1', ?, 'only', 'Only collection', 'Invented.', '[]', '2026-12-31', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z')`,
    );
    expect((await get(env, "whatever.example.test", "/api/collections")).status).toBe(200);
    insert.run(SELF_HOST_TENANT_ID);
    for (const host of ["whatever.example.test", "other.example.test:8080"]) {
      const body = (await (await get(env, host, "/api/collections")).json()) as { collections: Array<{ title: string }> };
      expect(body.collections.map((c) => c.title)).toEqual(["Only collection"]);
    }
  });

  it("signs in with the password end to end: D1 session for the synthetic owner, host-only cookie, logout revokes it", async () => {
    const { env, raw } = setup("single");
    const login = (password: string) =>
      worker.fetch(
        new Request("https://self.example.test/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://self.example.test", "cf-connecting-ip": "203.0.113.1" },
          body: JSON.stringify({ password }),
        }),
        env,
        ec,
      );
    expect((await login("wrong")).status).toBe(401);
    const ok = await login("pw");
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-rk_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/);
    expect(setCookie).not.toMatch(/domain=/i);
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 1 });

    const cookie = setCookie.split(";")[0] ?? "";
    const admin = (path: string, method = "GET") =>
      worker.fetch(new Request(`https://self.example.test${path}`, { method, headers: { cookie, origin: "https://self.example.test", "cf-connecting-ip": "203.0.113.1" } }), env, ec);
    expect(await (await admin("/api/admin/session")).json()).toEqual({ ok: true, role: "owner" });
    expect((await admin("/api/admin/payments")).status).toBe(200);
    expect((await admin("/api/admin/logout", "POST")).status).toBe(200);
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect((await admin("/api/admin/session")).status).toBe(401);
  });

  it("rate limits the password login on LOGIN_LIMITER per tenant and client", async () => {
    const { env, limiterKeys } = setup("single");
    await worker.fetch(
      new Request("https://self.example.test/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://self.example.test", "cf-connecting-ip": "203.0.113.5" },
        body: JSON.stringify({ password: "wrong" }),
      }),
      env,
      ec,
    );
    expect(limiterKeys).toEqual([`login:${SELF_HOST_TENANT_ID}:203.0.113.5`]);
  });

  it("answers 503 admin_disabled when ADMIN_PASSWORD is not set", async () => {
    const { env } = setup("single");
    const bare = { ...env, ADMIN_PASSWORD: "" } as unknown as CloudEnv;
    const res = await worker.fetch(new Request("https://self.example.test/api/admin/session", { headers: { "cf-connecting-ip": "203.0.113.1" } }), bare, ec);
    expect(res.status).toBe(503);
  });

  it("refuses a state-changing admin request whose Origin is not the resolved host", async () => {
    const { env } = setup("single");
    const res = await worker.fetch(
      new Request("https://self.example.test/api/admin/logout", { method: "POST", headers: { origin: "https://other.example.test" } }),
      env,
      ec,
    );
    expect(res.status).toBe(403);
  });
});

describe("misconfiguration", () => {
  it("fails closed with a generic 500 when TENANCY is neither multi nor single", async () => {
    const { env } = setup("multi");
    const broken = { ...env, TENANCY: undefined } as unknown as CloudEnv;
    const res = await get(broken, "demo-a.localhost", "/api/collections");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/TENANCY|demo/);
  });
});

describe("email()", () => {
  const mail = () => {
    const bytes = new TextEncoder().encode("From: x@example.test\r\nSubject: hi\r\n\r\nbody");
    const forward = vi.fn(async () => ({ messageId: "x" }));
    const setReject = vi.fn();
    const message = { from: "x@example.test", to: "d-token@in.localhost", headers: new Headers(), raw: new Response(bytes).body, rawSize: bytes.byteLength, setReject, forward } as unknown as ForwardableEmailMessage;
    return { message, forward, setReject };
  };

  it("single mode forwards first through the tenant context", async () => {
    const { env } = setup("single");
    const { message, forward, setReject } = mail();
    await worker.email(message, env);
    expect(forward).toHaveBeenCalledWith("treasurer@example.test");
    expect(setReject).not.toHaveBeenCalled();
  });

  it("single mode still forwards exactly once when tenant resolution throws (database down)", async () => {
    const { env } = setup("single", { failTenantReads: true });
    const { message, forward, setReject } = mail();
    await expect(worker.email(message, env)).resolves.toBeUndefined();
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith("treasurer@example.test");
    expect(setReject).not.toHaveBeenCalled();
  });

  it("single mode still forwards exactly once when no tenant resolves (a cloud tenant exists)", async () => {
    const { env, raw } = setup("single", { seed: true });
    const { message, forward, setReject } = mail();
    await worker.email(message, env);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(setReject).not.toHaveBeenCalled();
    expect(raw.sqlite.prepare("SELECT count(*) AS n FROM bank_movements").get()).toMatchObject({ n: 0 });
  });

  it("multi mode rejects until per-tenant inbound routing exists: no forward, no database or storage write", async () => {
    const { env, raw, bucket } = setup("multi");
    const { message, forward, setReject } = mail();
    await worker.email(message, env);
    expect(setReject).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(raw.sqlite.prepare("SELECT count(*) AS n FROM bank_movements").get()).toMatchObject({ n: 0 });
    expect(bucket.objects.size).toBe(0);
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("d-token");
  });
});

describe("per-tenant runtime config", () => {
  const HTML = `<!doctype html><html><head><title>Static</title><meta name="description" content="Static"></head><body></body></html>`;
  const html = (env: CloudEnv, host: string, path: string) => get(env, host, path);
  const configOf = async (env: CloudEnv, host: string) => (await get(env, host, "/api/config")).json() as Promise<Record<string, unknown> & { treasury: Record<string, unknown> }>;
  const withHtmlAssets = (env: CloudEnv): CloudEnv => ({ ...env, ASSETS: { fetch: async () => new Response(HTML, { headers: { "content-type": "text/html" } }) } }) as unknown as CloudEnv;

  it("GET /api/config gives each host only its own tenant's values", async () => {
    const { env } = setup("multi");
    const a = await configOf(env, "demo-a.localhost");
    const b = await configOf(env, "demo-b.localhost");
    expect([a["schoolName"], b["schoolName"]]).toEqual(["Demo School A", "Demo School B"]);
    expect([a.treasury["accountNumber"], b.treasury["accountNumber"]]).toEqual(["0000000000", "9999990000"]);
    expect([a["defaultTone"], b["defaultTone"]]).toEqual(["#C81E3A", "#1E3AC8"]);
    expect(a["auth"]).toEqual({ mode: "magic_link" });
    expect(JSON.stringify(a)).not.toMatch(/Demo School B|Demo Bank B|9999990000/);
  });

  it("never serves anything stored next to the config: hashes, prefixes, ids, stray secret fields", async () => {
    const { env, raw } = setup("multi");
    const stored = JSON.parse(String(raw.sqlite.prepare("SELECT config_json AS c FROM tenants WHERE id = ?").get(TENANT_A)?.["c"])) as Record<string, unknown>;
    raw.sqlite.prepare("UPDATE tenants SET config_json = ? WHERE id = ?").run(JSON.stringify({ ...stored, forwardTo: "treasurer@example.test", sessionSecret: "s3cret" }), TENANT_A);
    const body = await (await get(withHtmlAssets(env), "demo-a.localhost", "/api/config")).text();
    const page = await (await get(withHtmlAssets(env), "demo-a.localhost", "/")).text();
    for (const text of [body, page]) {
      expect(text).not.toMatch(/s3cret|treasurer@example|inbound|r2_prefix|a{16}|t\/a0000000/);
      expect(text).not.toContain(TENANT_A);
    }
  });

  it("answers a generic 503 for every route of a tenant whose config is invalid, and keeps serving the others", async () => {
    const { env, raw } = setup("multi");
    raw.sqlite.prepare("UPDATE tenants SET config_json = ? WHERE id = ?").run(JSON.stringify({ className: "Broken" }), TENANT_A);
    for (const path of ["/api/config", "/api/collections", "/", "/r/demo-collection", "/api/og/demo-collection.jpg"]) {
      const res = await get(withHtmlAssets(env), "demo-a.localhost", path);
      expect(res.status).toBe(503);
      expect(await res.text()).not.toMatch(/Broken|Demo|0000|bank/i);
    }
    expect((await get(env, "demo-b.localhost", "/api/config")).status).toBe(200);
  });

  it.each([
    ["/", "Recaudaciones Demo A"],
    ["/index.html", "Recaudaciones Demo A"],
    ["/admin", "Tesorería Demo A"],
    ["/admin.html", "Tesorería Demo A"],
    ["/r/demo-collection", "Demo collection A"],
    ["/r/not-a-collection", "Recaudaciones Demo A"],
  ])("%s carries the tenant's title and boot JSON, never another tenant's", async (path, title) => {
    const { env } = setup("multi");
    const res = await get(withHtmlAssets(env), "demo-a.localhost", path);
    const body = await res.text();
    expect(body).toContain(title);
    expect(body).toContain('id="rekauda-config"');
    expect(body).toContain("Demo School A");
    expect(body).not.toMatch(/Static|Demo School B|Demo class B|Demo collection B/);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Cache-Control")).toBe(path.startsWith("/admin") ? "no-store" : "no-cache");
  });

  it.each(["/admin/acceso", "/foo", "/r", "/admin/a/b"])("%s (SPA fallback HTML) also carries the tenant's boot JSON and title", async (path) => {
    const { env } = setup("multi");
    const res = await get(withHtmlAssets(env), "demo-a.localhost", path);
    const body = await res.text();
    expect(body).toContain('id="rekauda-config"');
    expect(body).toContain("Demo School A");
    expect(body).not.toContain("<title>Static</title>");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("leaves non-HTML assets untouched", async () => {
    const { env } = setup("multi");
    const asset = { ...env, ASSETS: { fetch: async () => new Response("console.log(1)", { headers: { "content-type": "text/javascript" } }) } } as unknown as CloudEnv;
    const res = await get(asset, "demo-a.localhost", "/assets/app.js");
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("answers a generic 503, not a 500, when the config read fails; and keeps the last good config", async () => {
    const down = setup("multi", { failConfigReads: true });
    const res = await get(down.env, "demo-a.localhost", "/api/config");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/D1|unavailable|Demo/);
  });

  it("caches /api/config for 60 s in both modes", async () => {
    expect((await get(setup("multi").env, "demo-a.localhost", "/api/config")).headers.get("Cache-Control")).toBe("public, max-age=60");
    expect((await get(setup("single").env, "self.example.test", "/api/config")).headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("does not answer the HTML entries for an unknown host", async () => {
    const { env } = setup("multi");
    const res = await get(withHtmlAssets(env), "nope.localhost", "/");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("rekauda-config");
  });

  it("serves a tenant's Deuna QR from its own prefix, and only the tenant that has one", async () => {
    const { env, raw, bucket } = setup("multi");
    raw.sqlite.prepare("UPDATE tenants SET qr_key = ? WHERE id = ?").run(`t/${TENANT_A}/assets/deuna-qr.png`, TENANT_A);
    bucket.objects.set(`t/${TENANT_A}/assets/deuna-qr.png`, "A-QR");
    const config = await configOf(env, "demo-a.localhost");
    expect(config.treasury["qrUrl"]).toMatch(/^\/api\/assets\/deuna-qr\.png\?v=/);
    expect((await configOf(env, "demo-b.localhost")).treasury["qrUrl"]).toBeNull();

    const own = await get(env, "demo-a.localhost", String(config.treasury["qrUrl"]));
    expect([own.status, await own.text()]).toEqual([200, "A-QR"]);
    const other = await get(env, "demo-b.localhost", String(config.treasury["qrUrl"]));
    expect(other.status).toBe(404);
    expect(bucket.reads).toEqual([`t/${TENANT_A}/assets/deuna-qr.png`]);
  });

  it("POST /api/payments checks the bank against the tenant's own list", async () => {
    const { env, raw } = setup("multi");
    const body = new FormData();
    body.set("collection", "demo-collection");
    body.set("consent", "si");
    body.set("students", JSON.stringify([{ givenNames: "Mateo", surnames: "Andrade", option: "standard" }]));
    body.set("parentName", "Carolina Vasquez");
    body.set("phone", "0990000000");
    body.set("transferDate", new Date().toISOString().slice(0, 10));
    body.set("bank", "Demo Bank B");
    body.set("amount", "10,00");
    body.set("receipt", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "r.png", { type: "image/png" }));
    const packed = new Response(body);
    const bytes = new Uint8Array(await packed.arrayBuffer());
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/payments", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.1", "content-type": packed.headers.get("content-type") ?? "", "content-length": String(bytes.byteLength) },
        body: bytes,
      }),
      env,
      ec,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_bank");
    expect(raw.sqlite.prepare("SELECT count(*) AS n FROM payments").get()).toMatchObject({ n: 0 });
  });

  it("the admin .eml import is reachable in multi mode only with a session (411 here: the request carries no file)", async () => {
    const { env, raw } = setup("multi");
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/movements/import", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.1", cookie: await cloudCookie(raw, TENANT_A, OWNER_A), origin: "https://demo-a.localhost" },
      }),
      env,
      ec,
    );
    expect(res.status).toBe(411);
  });

  it("single mode serves the bundled config with the password sign-in mode", async () => {
    const { env } = setup("single");
    const res = await get(env, "self.example.test", "/api/config");
    const config = (await res.json()) as { schoolName: string; auth: unknown };
    expect(res.status).toBe(200);
    expect([config.schoolName, config.auth]).toEqual(["Mi Colegio", { mode: "password" }]);
  });

  it("single mode injects the bundled config into the HTML too", async () => {
    const { env } = setup("single");
    const body = await (await get(withHtmlAssets(env), "self.example.test", "/")).text();
    expect(body).toContain("Recaudaciones 1.º Básica A");
    expect(body).toContain("Mi Colegio");
  });
});

describe("missing client address", () => {
  it("fails closed for uncached host lookups in multi mode and reads nothing", async () => {
    const { env, lookups } = setup("multi");
    const res = await worker.fetch(new Request("https://demo-a.localhost/api/collections"), env, ec);
    expect(res.status).toBe(429);
    expect(lookups).toEqual([]);
  });
});

describe("import database failure", () => {
  const TEXT = [
    "Hola, Ana",
    "Recibiste $14,00 de Torres Mendez Lucia Ana con Deuna!",
    "Los detalles de tu pago",
    "Monto: $14,00 USD",
    "Motivo: Transf JEP",
    "Fecha: 26 nov 2026 - 09h02",
    "Cuenta de origen: Coop. Jep ********0000",
    "Cuenta de destino: ******0000",
    "Nombre del ordenante: Torres Mendez Lucia Ana",
    "Número de transacción: 500000000001",
    "",
  ].join("\r\n");

  it("answers a generic JSON 500 without leaking constraint or table names", async () => {
    const key = await generateKey();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ Answer: [{ type: 16, data: `"v=DKIM1; k=rsa; p=${key.publicBase64}"` }] })));
    try {
      const { env, raw } = setup("single");
      await get(env, "self.example.test", "/api/collections");
      const cookie = await singleCookie(env, "self.example.test");
      raw.sqlite.exec("CREATE TRIGGER boom BEFORE INSERT ON bank_movements BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: bank_movements.secret_rule'); END");
      const eml = await signMessage(
        key,
        [
          ["From", "Deuna <notificaciones@deunaapp.com>"],
          ["Subject", "Recibiste $14,00"],
          ["Message-ID", "<m1@deunaapp.com>"],
          ["Date", "Thu, 26 Nov 2026 14:02:11 +0000"],
          ["MIME-Version", "1.0"],
          ["Content-Type", "text/plain; charset=utf-8"],
          ["Content-Transfer-Encoding", "8bit"],
        ],
        TEXT,
      );
      const form = new FormData();
      form.set("eml", new File([eml], "m.eml", { type: "message/rfc822" }));
      const packed = new Response(form);
      const bytes = new Uint8Array(await packed.arrayBuffer());
      const res = await worker.fetch(
        new Request("https://self.example.test/api/admin/movements/import", {
          method: "POST",
          headers: { origin: "https://self.example.test", cookie, "content-type": packed.headers.get("content-type") ?? "", "content-length": String(bytes.byteLength) },
          body: bytes,
        }),
        env,
        ec,
      );
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toContain("application/json");
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ error: "internal" });
      expect(text).not.toMatch(/CHECK|constraint|bank_movements|secret_rule/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
