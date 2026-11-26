import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import example from "../../../rekauda.config.example";
import { PlatformDb } from "../data/platform-db";
import { asD1 } from "../test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "../test/d1-cloud";
import { TtlCache } from "./cache";
import { BundledConfigStore, D1ConfigStore } from "./config-store";
import type { Tenant } from "./tenant";
import type { Instance } from "../../shared/instance";

const tenantA: Tenant = { id: TENANT_A, slug: "demo-a", r2Prefix: `t/${TENANT_A}/`, source: "cloud" };
const tenantB: Tenant = { id: TENANT_B, slug: "demo-b", r2Prefix: `t/${TENANT_B}/`, source: "cloud" };

function stores() {
  const raw = createCloudTestDb({ seed: true });
  const reads: string[] = [];
  const db = {
    prepare: (sql: string) => (reads.push(sql), raw.prepare(sql)),
    batch: raw.batch.bind(raw),
  };
  const store = new D1ConfigStore(new PlatformDb(asD1(db as unknown as typeof raw)), new TtlCache<Instance>());
  return { raw, reads, store };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("BundledConfigStore", () => {
  it("serves the validated bundled config to whatever tenant asks, without touching a database", async () => {
    const config = await new BundledConfigStore().load(tenantA);
    expect(config?.schoolName).toBe(example.schoolName);
    expect(config?.earliestTransferLabel).toBe("noviembre de 2026");
    expect(config?.treasury.qrUrl).toBe(example.treasury.qrUrl);
  });
});

describe("D1ConfigStore", () => {
  it("gives each tenant only its own config", async () => {
    const { store } = stores();
    const a = await store.load(tenantA);
    const b = await store.load(tenantB);
    expect([a?.schoolName, b?.schoolName]).toEqual(["Demo School A", "Demo School B"]);
    expect([a?.treasury.accountNumber, b?.treasury.accountNumber]).toEqual(["0000000000", "9999990000"]);
    expect(JSON.stringify(a)).not.toContain("Demo School B");
  });

  it("fails closed (null, never a partial config) when config_json breaks a rule, logging level, tenant id and field only", async () => {
    const { raw, store } = stores();
    raw.sqlite.prepare("UPDATE tenants SET config_json = ? WHERE id = ?").run(JSON.stringify({ className: "Only a name" }), TENANT_A);
    expect(await store.load(tenantA)).toBeNull();
    const logged = String((console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ level: "error", message: "tenant_config_invalid", tenantId: TENANT_A });
    expect(logged).not.toContain("Only a name");
  });

  it("fails closed for an invalid rule value, and for JSON that is not an object, without echoing the content", async () => {
    const { raw, store } = stores();
    const good = JSON.parse(String(raw.sqlite.prepare("SELECT config_json AS c FROM tenants WHERE id = ?").get(TENANT_A)?.["c"])) as Record<string, unknown>;
    raw.sqlite.prepare("UPDATE tenants SET config_json = ? WHERE id = ?").run(JSON.stringify({ ...good, defaultTone: "red" }), TENANT_A);
    expect(await store.load(tenantA)).toBeNull();
    raw.sqlite.prepare("UPDATE tenants SET config_json = '[1,2]' WHERE id = ?").run(TENANT_B);
    expect(await store.load(tenantB)).toBeNull();
    expect(String((console.error as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]))).not.toContain("[1,2]");
  });

  it("is null for a tenant that is not active or does not exist", async () => {
    const { raw, store } = stores();
    raw.sqlite.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(TENANT_A);
    expect(await store.load(tenantA)).toBeNull();
    expect(await store.load({ ...tenantA, id: "00000000-0000-4000-8000-0000000000ff" })).toBeNull();
  });

  it("drops anything in the row that is not part of the public config", async () => {
    const { raw, store } = stores();
    const good = JSON.parse(String(raw.sqlite.prepare("SELECT config_json AS c FROM tenants WHERE id = ?").get(TENANT_A)?.["c"])) as Record<string, unknown>;
    raw.sqlite.prepare("UPDATE tenants SET config_json = ? WHERE id = ?").run(JSON.stringify({ ...good, forwardTo: "secret@example.test", sessionSecret: "s3cret" }), TENANT_A);
    expect(JSON.stringify(await store.load(tenantA))).not.toMatch(/secret/);
  });

  it("builds the QR url from the tenant's own asset, ignoring a qrUrl written in config_json", async () => {
    const { raw, store } = stores();
    const good = JSON.parse(String(raw.sqlite.prepare("SELECT config_json AS c FROM tenants WHERE id = ?").get(TENANT_A)?.["c"])) as { treasury: Record<string, unknown> };
    good.treasury["qrUrl"] = "/some-other-path.png";
    raw.sqlite.prepare("UPDATE tenants SET config_json = ? WHERE id = ?").run(JSON.stringify(good), TENANT_A);
    expect((await store.load(tenantA))?.treasury.qrUrl).toBeNull();

    raw.sqlite.prepare("UPDATE tenants SET qr_key = ? WHERE id = ?").run(`t/${TENANT_A}/assets/deuna-qr.png`, TENANT_A);
    const url = (await new D1ConfigStore(new PlatformDb(asD1(raw)), new TtlCache<Instance>()).load(tenantA))?.treasury.qrUrl;
    expect(url).toMatch(/^\/api\/assets\/deuna-qr\.png\?v=[a-z0-9]+$/);
  });

  it("ignores a qr_key that is not this tenant's own deuna-qr asset", async () => {
    const { raw } = stores();
    for (const key of [`t/${TENANT_B}/assets/deuna-qr.png`, `t/${TENANT_A}/assets/deuna-qr.svg`, `t/${TENANT_A}/receipts/x.png`, "../x"]) {
      raw.sqlite.prepare("UPDATE tenants SET qr_key = ? WHERE id = ?").run(key, TENANT_A);
      const fresh = new D1ConfigStore(new PlatformDb(asD1(raw)), new TtlCache<Instance>());
      expect((await fresh.load(tenantA))?.treasury.qrUrl).toBeNull();
    }
  });

  it("reads qr versions from updated_at as UTC, with or without a zone suffix", async () => {
    const { raw } = stores();
    raw.sqlite.prepare("UPDATE tenants SET qr_key = ? WHERE id = ?").run(`t/${TENANT_A}/assets/deuna-qr.png`, TENANT_A);
    const versionWith = async (updatedAt: string) => {
      raw.sqlite.prepare("UPDATE tenants SET updated_at = ? WHERE id = ?").run(updatedAt, TENANT_A);
      return (await new D1ConfigStore(new PlatformDb(asD1(raw)), new TtlCache<Instance>()).load(tenantA))?.treasury.qrUrl;
    };
    const zoned = await versionWith("2026-11-26T10:00:00.000Z");
    expect(await versionWith("2026-11-26T10:00:00.000")).toBe(zoned);
    expect(zoned).toBe(`/api/assets/deuna-qr.png?v=${Date.parse("2026-11-26T10:00:00.000Z").toString(36)}`);
  });

  it("reads the database once per tenant while cached", async () => {
    const { reads, store } = stores();
    await store.load(tenantA);
    await store.load(tenantA);
    expect(reads.filter((sql) => sql.includes("config_json"))).toHaveLength(1);
  });
});

describe("D1ConfigStore when the database fails", () => {
  const failing = (error: Error) => ({ readTenantConfig: vi.fn(async () => Promise.reject(error)) });

  it("is null (generic 503 upstream) with no good value yet, logs without values, and does not retry for 10 s", async () => {
    let now = 0;
    const platform = failing(new Error("D1_ERROR: secret detail"));
    const store = new D1ConfigStore(platform, new TtlCache<Instance>({ now: () => now }));
    expect(await store.load(tenantA)).toBeNull();
    const logged = String((console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ level: "error", message: "tenant_config_unavailable", tenantId: TENANT_A });
    expect(logged).not.toContain("secret detail");
    now = 9_999;
    expect(await store.load(tenantA)).toBeNull();
    expect(platform.readTenantConfig).toHaveBeenCalledTimes(1);
    now = 10_001;
    await store.load(tenantA);
    expect(platform.readTenantConfig).toHaveBeenCalledTimes(2);
  });

  it("serves the last good config when a refresh fails (stale-if-error), still only that tenant's", async () => {
    let now = 0;
    const { raw } = stores();
    let broken = false;
    const real = new PlatformDb(asD1(raw));
    const platform = { readTenantConfig: async (id: string) => (broken ? Promise.reject(new Error("D1 down")) : real.readTenantConfig(id)) };
    const store = new D1ConfigStore(platform, new TtlCache<Instance>({ now: () => now }));
    const first = await store.load(tenantA);
    expect(first?.schoolName).toBe("Demo School A");
    broken = true;
    now = 61_000;
    expect((await store.load(tenantA))?.schoolName).toBe("Demo School A");
    expect(await store.load(tenantB)).toBeNull();
  });
});
