import { describe, expect, it } from "vitest";
import { PlatformDb, SELF_HOST_OWNER_EMAIL, SELF_HOST_TENANT_ID } from "../data/platform-db";
import type { TestDb } from "../test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "../test/d1-cloud";
import { TtlCache } from "./cache";
import { HostTenantResolver, SingleTenantResolver, tenantNotFound } from "./resolver";
import type { Tenant } from "./tenant";

const NOW = "2026-11-26T00:00:00.000Z";

/** Counts statements so tests can prove cache hits and short-circuits. */
function counting(raw: TestDb, failFirstBatch = false) {
  const stats = { prepares: 0 };
  let failed = !failFirstBatch;
  const db = {
    prepare: (sql: string) => {
      stats.prepares += 1;
      return raw.prepare(sql);
    },
    batch: (statements: Parameters<TestDb["batch"]>[0]) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error("transient"));
      }
      return raw.batch(statements);
    },
  };
  return { stats, platform: new PlatformDb(db as unknown as D1Database) };
}

function insertTenant(raw: TestDb, id: string, slug: string, hostnames: string[], options: { status?: string; kind?: string; verified?: boolean } = {}): void {
  raw.sqlite
    .prepare("INSERT INTO tenants (id, slug, status, config_json, r2_prefix, source, created_at, updated_at) VALUES (?1, ?2, ?3, '{}', 't/' || ?1 || '/', 'cloud', ?4, ?4)")
    .run(id, slug, options.status ?? "active", NOW);
  for (const hostname of hostnames) {
    raw.sqlite
      .prepare("INSERT INTO tenant_domains (hostname, tenant_id, kind, verified_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(hostname, id, options.kind ?? "subdomain", options.verified ? NOW : null, NOW);
  }
}

const tenantA: Tenant = { id: TENANT_A, slug: "demo-a", r2Prefix: `t/${TENANT_A}/`, source: "cloud" };
const tenantB: Tenant = { id: TENANT_B, slug: "demo-b", r2Prefix: `t/${TENANT_B}/`, source: "cloud" };

describe("HostTenantResolver", () => {
  const make = (raw = createCloudTestDb({ seed: true }), cache?: TtlCache<Tenant>) => {
    const { stats, platform } = counting(raw);
    return { raw, stats, resolver: new HostTenantResolver(platform, "localhost", cache) };
  };

  it("resolves each tenant from its own host", async () => {
    const { resolver } = make();
    expect(await resolver.resolve("demo-a.localhost")).toEqual(tenantA);
    expect(await resolver.resolve("demo-b.localhost")).toEqual(tenantB);
  });

  it("normalises casing, port and trailing dot to the same tenant", async () => {
    const { resolver } = make();
    for (const host of ["DEMO-A.localhost", "demo-a.localhost:8799", "demo-a.localhost.", " Demo-A.LOCALHOST.:443 "]) {
      expect(await resolver.resolve(host)).toEqual(tenantA);
    }
  });

  it("resolves a verified custom domain from tenant_domains", async () => {
    const raw = createCloudTestDb({ seed: true });
    insertTenant(raw, "c1000000-0000-4000-8000-000000000001", "curso-c", ["pagos.colegio.example"], { kind: "custom", verified: true });
    expect((await make(raw).resolver.resolve("Pagos.Colegio.Example:443"))?.slug).toBe("curso-c");
  });

  it("does not resolve a custom domain that was never verified", async () => {
    const raw = createCloudTestDb({ seed: true });
    insertTenant(raw, "c1000000-0000-4000-8000-000000000001", "curso-c", ["pagos.colegio.example"], { kind: "custom" });
    expect(await make(raw).resolver.resolve("pagos.colegio.example")).toBeNull();
  });

  it("returns frozen tenants so a cached value cannot be mutated by a handler", async () => {
    const tenant = await make().resolver.resolve("demo-a.localhost");
    expect(Object.isFrozen(tenant)).toBe(true);
  });

  it("returns null for unknown, malformed and apex hosts", async () => {
    const { resolver } = make();
    for (const host of ["nope.localhost", "", "a b.localhost", "x.y.localhost", "localhost", "www.localhost", "other.example"]) {
      expect(await resolver.resolve(host)).toBeNull();
    }
  });

  it("does not query the database for apex, malformed or reserved hosts", async () => {
    const { resolver, stats } = make();
    for (const host of ["localhost", "www.localhost", "admin.localhost", "bad host", ""]) await resolver.resolve(host);
    expect(stats.prepares).toBe(0);
    await resolver.resolve("demo-a.localhost");
    expect(stats.prepares).toBe(1);
  });

  it("rejects a reserved subdomain even when a tenant row was force-inserted", async () => {
    const raw = createCloudTestDb({ seed: true });
    insertTenant(raw, "c2000000-0000-4000-8000-000000000002", "admin", ["admin.localhost"]);
    expect(await make(raw).resolver.resolve("admin.localhost")).toBeNull();
  });

  it("returns null for a suspended tenant, like an unknown host", async () => {
    const raw = createCloudTestDb({ seed: true });
    insertTenant(raw, "c3000000-0000-4000-8000-000000000003", "pausado", ["pausado.localhost"], { status: "suspended" });
    const { resolver } = make(raw);
    expect(await resolver.resolve("pausado.localhost")).toBeNull();
    expect(await resolver.resolve("demo-a.localhost")).toEqual(tenantA);
  });

  it("caches hits for 60 seconds and misses for 15, then re-reads", async () => {
    const clock = { now: 5_000_000 };
    const raw = createCloudTestDb({ seed: true });
    const { resolver, stats } = make(raw, new TtlCache({ now: () => clock.now }));
    await resolver.resolve("demo-a.localhost");
    await resolver.resolve("demo-a.localhost");
    expect(stats.prepares).toBe(1);
    raw.sqlite.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(TENANT_A);
    clock.now += 59_000;
    expect((await resolver.resolve("demo-a.localhost"))?.id).toBe(TENANT_A);
    clock.now += 1_000;
    expect(await resolver.resolve("demo-a.localhost")).toBeNull();
    expect(stats.prepares).toBe(2);

    await resolver.resolve("later.localhost");
    insertTenant(raw, "c4000000-0000-4000-8000-000000000004", "later", ["later.localhost"]);
    clock.now += 14_000;
    expect(await resolver.resolve("later.localhost")).toBeNull();
    clock.now += 1_000;
    expect((await resolver.resolve("later.localhost"))?.slug).toBe("later");
  });
});

describe("tenantNotFound", () => {
  it("is identical for every unknown, suspended or malformed host and carries no tenant information", async () => {
    const [a, b] = [tenantNotFound(), tenantNotFound()];
    expect(a.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
    expect(await tenantNotFound().json()).toEqual({ error: "not_found", message: "No encontramos esta página." });
  });
});

describe("SingleTenantResolver", () => {
  const counts = (raw: TestDb) => ({
    tenants: raw.sqlite.prepare("SELECT count(*) AS n FROM tenants").get(),
    users: raw.sqlite.prepare("SELECT count(*) AS n FROM users WHERE kind = 'synthetic'").get(),
    owners: raw.sqlite.prepare("SELECT count(*) AS n FROM memberships WHERE role = 'owner'").get(),
  });

  it("maps any host to the one seeded tenant, creating it idempotently", async () => {
    const raw = createCloudTestDb();
    const resolver = new SingleTenantResolver(counting(raw).platform, () => 0);
    const expected: Tenant = { id: SELF_HOST_TENANT_ID, slug: "self-host", r2Prefix: "", source: "self_host" };
    expect(await resolver.resolve("anything.example.com")).toEqual(expected);
    expect(await resolver.resolve("")).toEqual(expected);
    expect(counts(raw)).toEqual({ tenants: { n: 1 }, users: { n: 1 }, owners: { n: 1 } });
    expect(raw.sqlite.prepare("SELECT email FROM users WHERE kind = 'synthetic'").get()).toEqual({ email: SELF_HOST_OWNER_EMAIL });
  });

  it("stays at one tenant when a second isolate provisions again", async () => {
    const raw = createCloudTestDb();
    for (let i = 0; i < 2; i++) await new SingleTenantResolver(counting(raw).platform).resolve("h");
    expect(counts(raw)).toEqual({ tenants: { n: 1 }, users: { n: 1 }, owners: { n: 1 } });
  });

  it("refuses to serve when a cloud tenant exists, and writes nothing", async () => {
    const raw = createCloudTestDb({ seed: true });
    expect(await new SingleTenantResolver(counting(raw).platform).resolve("h")).toBeNull();
    expect(raw.sqlite.prepare("SELECT count(*) AS n FROM tenants WHERE source = 'self_host'").get()).toEqual({ n: 0 });
  });

  it("stops serving once a cloud tenant appears after provisioning", async () => {
    const raw = createCloudTestDb();
    const resolver = new SingleTenantResolver(counting(raw).platform, () => 0);
    expect((await resolver.resolve("h"))?.id).toBe(SELF_HOST_TENANT_ID);
    insertTenant(raw, "c5000000-0000-4000-8000-000000000005", "cloud-x", []);
    expect(await new SingleTenantResolver(counting(raw).platform).resolve("h")).toBeNull();
  });

  it("stops serving on the same resolver as soon as a cloud tenant appears (no stale cache)", async () => {
    const raw = createCloudTestDb();
    const resolver = new SingleTenantResolver(counting(raw).platform, () => 0);
    expect((await resolver.resolve("h"))?.id).toBe(SELF_HOST_TENANT_ID);
    insertTenant(raw, "c6000000-0000-4000-8000-000000000006", "cloud-y", []);
    expect(await resolver.resolve("h")).toBeNull();
  });

  it("throws instead of skipping silently when provisioning cannot create its rows", async () => {
    const taken = createCloudTestDb();
    taken.sqlite
      .prepare("INSERT INTO tenants (id, slug, config_json, r2_prefix, source, created_at, updated_at) VALUES ('d0000000-0000-4000-8000-000000000001', 'legacy', '{}', '', 'pilot_import', ?1, ?1)")
      .run(NOW);
    await expect(new SingleTenantResolver(counting(taken).platform).resolve("h")).rejects.toThrow("self-host provisioning incomplete");

    const taken2 = createCloudTestDb();
    taken2.sqlite.prepare("INSERT INTO users (id, email, kind, created_at) VALUES ('d1000000-0000-4000-8000-000000000001', ?, 'person', ?)").run(SELF_HOST_OWNER_EMAIL, NOW);
    await expect(new SingleTenantResolver(counting(taken2).platform).resolve("h")).rejects.toThrow("self-host provisioning incomplete");
  });

  it("fails closed when the tenant is suspended", async () => {
    const suspended = createCloudTestDb();
    await new SingleTenantResolver(counting(suspended).platform).resolve("h");
    suspended.sqlite.prepare("UPDATE tenants SET status = 'suspended'").run();
    expect(await new SingleTenantResolver(counting(suspended).platform).resolve("h")).toBeNull();
  });

  it("retries provisioning after a transient failure", async () => {
    const raw = createCloudTestDb();
    const resolver = new SingleTenantResolver(counting(raw, true).platform);
    await expect(resolver.resolve("h")).rejects.toThrow("transient");
    expect((await resolver.resolve("h"))?.id).toBe(SELF_HOST_TENANT_ID);
  });
});
