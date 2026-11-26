/**
 * Composition root: tenant resolution from the Host header, generic 404s, client-supplied tenants ignored, the
 * unknown-host read guard, admin disabled in multi mode and the email() entry point. og-image (WASM renderer) is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudEnv } from "./env";
import worker from "./index";
import { resetTenancyState } from "./tenancy/runtime";
import { asD1, type TestDb } from "./test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./test/d1-cloud";
import { adminCookie } from "./test/harness";
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

function setup(mode: "multi" | "single", options: { seed?: boolean; limitOk?: boolean; failTenantReads?: boolean } = {}): Setup & { env: CloudEnv } {
  const raw = createCloudTestDb({ seed: options.seed ?? mode === "multi" });
  const bucket = new FakeBucket();
  const lookups: string[] = [];
  const assetCalls: string[] = [];
  const limiterKeys: string[] = [];
  const db = {
    prepare: (sql: string) => {
      if (sql.includes("tenant_domains")) lookups.push(sql);
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
      : { ...common, TENANCY: "single", ADMIN_PASSWORD: "pw", SESSION_SECRET: "test-session-secret", FORWARD_TO: "treasurer@example.test" };
  return { raw, bucket, lookups, assetCalls, limiterKeys, env: env as unknown as CloudEnv };
}

const get = (env: CloudEnv, host: string, path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://${host}${path}`, { headers: { "cf-connecting-ip": "203.0.113.1", ...headers } }), env, ec);

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
  it("stays disabled (503) even if an admin password secret exists, because the legacy cookie is not tenant-bound", async () => {
    const { env } = setup("multi");
    const withSecrets = { ...env, ADMIN_PASSWORD: "pw", SESSION_SECRET: "s" } as unknown as CloudEnv;
    const cookie = await adminCookie();
    const res = await worker.fetch(new Request("https://demo-a.localhost/api/admin/payments", { headers: { cookie, "cf-connecting-ip": "203.0.113.1" } }), withSecrets, ec);
    expect(res.status).toBe(503);
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

  it("keeps the password login working and the cookie host-only", async () => {
    const { env } = setup("single");
    const login = (password: string) =>
      worker.fetch(
        new Request("https://self.example.test/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://self.example.test" },
          body: JSON.stringify({ password }),
        }),
        env,
        ec,
      );
    expect((await login("wrong")).status).toBe(401);
    const ok = await login("pw");
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^adm=/);
    expect(cookie).not.toMatch(/domain=/i);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
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

describe("bundled instance config is never served in multi mode", () => {
  const form = async () => {
    const body = new FormData();
    body.set("collection", "demo-collection");
    const packed = new Response(body);
    const bytes = new Uint8Array(await packed.arrayBuffer());
    return { bytes, type: packed.headers.get("content-type") ?? "" };
  };

  it.each([
    ["GET", "/api/config"],
    ["GET", "/api/og/demo-collection.jpg"],
    ["GET", "/r/demo-collection"],
  ])("%s %s answers a generic 503", async (method, path) => {
    const { env } = setup("multi");
    const res = await worker.fetch(new Request(`https://demo-a.localhost${path}`, { method, headers: { "cf-connecting-ip": "203.0.113.1" } }), env, ec);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/0000|banco|bank|school|colegio|treasur/i);
  });

  it("POST /api/payments answers 503 before any limiter, body read or write", async () => {
    const { env, raw, bucket, limiterKeys } = setup("multi");
    const { bytes, type } = await form();
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/payments", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1", "content-type": type, "content-length": String(bytes.byteLength) }, body: bytes }),
      env,
      ec,
    );
    expect(res.status).toBe(503);
    expect(raw.sqlite.prepare("SELECT count(*) AS n FROM payments").get()).toMatchObject({ n: 0 });
    expect(bucket.objects.size).toBe(0);
    expect(limiterKeys.filter((k) => k.startsWith("submit:"))).toEqual([]);
  });

  it("the admin .eml import (the Deuna last-4 check) is unreachable: admin is disabled", async () => {
    const { env } = setup("multi");
    const res = await worker.fetch(
      new Request("https://demo-a.localhost/api/admin/movements/import", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1", cookie: await adminCookie(), origin: "https://demo-a.localhost" } }),
      env,
      ec,
    );
    expect(res.status).toBe(503);
  });

  it("single mode keeps serving the bundled config", async () => {
    const { env } = setup("single");
    expect((await get(env, "self.example.test", "/api/config")).status).toBe(200);
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
          headers: { origin: "https://self.example.test", cookie: await adminCookie(), "content-type": packed.headers.get("content-type") ?? "", "content-length": String(bytes.byteLength) },
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
