import { describe, expect, it } from "vitest";
import { FakeBucket, asR2 } from "../test/r2-fake";
import { TENANT_A, TENANT_B } from "../test/d1-cloud";
import { assetKey, coverKey, ogKey, receiptKey, tenantPrefix } from "./keys";
import { TenantStorage, TenantStorageViolation } from "./tenant-storage";

const cloud = (id: string) => ({ id, r2Prefix: tenantPrefix(id), source: "cloud" as const });

describe("key builders", () => {
  it("builds tenant-relative keys", () => {
    expect(tenantPrefix(TENANT_A)).toBe(`t/${TENANT_A}/`);
    expect(receiptKey("pay-1", "png")).toBe("receipts/pay-1.png");
    expect(coverKey("col-1", "0123456789abcdef", "webp")).toBe("covers/col-1/0123456789abcdef.webp");
    expect(ogKey("curso-a", "v3")).toBe("og/curso-a/v3.jpg");
    expect(assetKey("deuna-qr.png")).toBe("assets/deuna-qr.png");
  });
});

describe("TenantStorage writes", () => {
  it("prefixes every kind with t/<tenantId>/ and returns the full key", async () => {
    const bucket = new FakeBucket();
    const storage = new TenantStorage(asR2(bucket), cloud(TENANT_B));
    const keys = await Promise.all([
      storage.put(receiptKey("p1", "png"), "r"),
      storage.put(coverKey("c1", "0123456789abcdef", "jpg"), "c"),
      storage.put(ogKey("curso-b", "v1"), "o"),
      storage.put(assetKey("deuna-qr.png"), "q"),
    ]);
    expect(keys).toEqual([
      `t/${TENANT_B}/receipts/p1.png`,
      `t/${TENANT_B}/covers/c1/0123456789abcdef.jpg`,
      `t/${TENANT_B}/og/curso-b/v1.jpg`,
      `t/${TENANT_B}/assets/deuna-qr.png`,
    ]);
    expect([...bucket.objects.keys()].sort()).toEqual([...keys].sort());
  });

  it.each(["receipts/../t/other/receipts/x.png", "../x", "receipts//x.png", "/receipts/x.png", "receipts/x.png/", "receipts\\x.png", "t/other/receipts/x.png", "misc/x.png", "receipts/.", "receipts/...", "receipts/%2e%2e/x", "receipts/é", "receipts/a\u0000b", ""])(
    "rejects the relative key %j",
    async (key) => {
      const bucket = new FakeBucket();
      await expect(new TenantStorage(asR2(bucket), cloud(TENANT_A)).put(key, "x")).rejects.toThrow(TenantStorageViolation);
      expect(bucket.objects.size).toBe(0);
    },
  );
});

describe("TenantStorage reads", () => {
  it("reads, heads and deletes own keys", async () => {
    const bucket = new FakeBucket();
    const storage = new TenantStorage(asR2(bucket), cloud(TENANT_A));
    const key = await storage.put(receiptKey("p1", "png"), "own");
    expect(await (await storage.get(key))?.text()).toBe("own");
    expect((await storage.head(key))?.key).toBe(key);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it.each([
    ["a foreign tenant", `t/${TENANT_B}/receipts/p1.png`],
    ["a traversal", `t/${TENANT_A}/receipts/../../${TENANT_B}/receipts/p1.png`],
    ["a bare key", "receipts/p1.png"],
    ["the prefix alone", `t/${TENANT_A}/`],
    ["a prefix lookalike", `t/${TENANT_A}x/receipts/p1.png`],
    ["a dots-only segment", `t/${TENANT_A}/receipts/.../p1.png`],
  ])("rejects %s without touching the bucket", async (_name, key) => {
    const bucket = new FakeBucket();
    bucket.objects.set(key, "secret");
    const storage = new TenantStorage(asR2(bucket), cloud(TENANT_A));
    await expect(storage.get(key)).rejects.toThrow(TenantStorageViolation);
    await expect(storage.head(key)).rejects.toThrow(TenantStorageViolation);
    await expect(storage.delete(key)).rejects.toThrow(TenantStorageViolation);
    expect(bucket.reads).toEqual([]);
    expect(bucket.objects.get(key)).toBe("secret");
  });
});

describe("empty prefix (legacy tenants)", () => {
  it("is allowed only for self_host and pilot_import and keeps the legacy key shape", async () => {
    for (const source of ["self_host", "pilot_import"] as const) {
      const bucket = new FakeBucket();
      const storage = new TenantStorage(asR2(bucket), { id: TENANT_A, r2Prefix: "", source });
      expect(await storage.put(receiptKey("p1", "png"), "x")).toBe("receipts/p1.png");
      expect(await (await storage.get("receipts/p1.png"))?.text()).toBe("x");
    }
  });

  it("never reaches the t/ namespace of other tenants", async () => {
    const bucket = new FakeBucket();
    const storage = new TenantStorage(asR2(bucket), { id: TENANT_A, r2Prefix: "", source: "pilot_import" });
    await expect(storage.get(`t/${TENANT_B}/receipts/p1.png`)).rejects.toThrow(TenantStorageViolation);
    expect(bucket.reads).toEqual([]);
  });

  it("is refused for a cloud tenant", () => {
    expect(() => new TenantStorage(asR2(new FakeBucket()), { id: TENANT_A, r2Prefix: "", source: "cloud" })).toThrow(TenantStorageViolation);
  });

  it("refuses a prefix that is not the tenant's own", () => {
    expect(() => new TenantStorage(asR2(new FakeBucket()), { id: TENANT_A, r2Prefix: tenantPrefix(TENANT_B), source: "cloud" })).toThrow(TenantStorageViolation);
    expect(() => new TenantStorage(asR2(new FakeBucket()), { id: TENANT_A, r2Prefix: "t/", source: "self_host" })).toThrow(TenantStorageViolation);
  });
});

describe("TenantStorage keyFor, list and multi-delete", () => {
  it("keyFor returns the full key for a relative key and refuses anything else", () => {
    const storage = new TenantStorage(asR2(new FakeBucket()), cloud(TENANT_A));
    expect(storage.keyFor(coverKey("c1", "0123456789abcdef", "png"))).toBe(`t/${TENANT_A}/covers/c1/0123456789abcdef.png`);
    expect(() => storage.keyFor("../x")).toThrow(TenantStorageViolation);
    expect(() => storage.keyFor(`t/${TENANT_B}/receipts/x.png`)).toThrow(TenantStorageViolation);
  });

  it("lists only keys under the tenant prefix, returned as full keys", async () => {
    const bucket = new FakeBucket();
    const a = new TenantStorage(asR2(bucket), cloud(TENANT_A));
    const b = new TenantStorage(asR2(bucket), cloud(TENANT_B));
    await a.put(ogKey("curso", "v1"), "1");
    await a.put(ogKey("curso", "v2"), "2");
    await b.put(ogKey("curso", "v9"), "9");
    expect((await a.list("og/curso/")).sort()).toEqual([`t/${TENANT_A}/og/curso/v1.jpg`, `t/${TENANT_A}/og/curso/v2.jpg`]);
    expect(bucket.lists).toEqual([`t/${TENANT_A}/og/curso/`]);
    await expect(a.list("../")).rejects.toThrow(TenantStorageViolation);
    await expect(a.list(`t/${TENANT_B}/og/`)).rejects.toThrow(TenantStorageViolation);
    expect(bucket.lists).toHaveLength(1);
  });

  it("deletes several own keys at once and refuses the whole call when one is foreign", async () => {
    const bucket = new FakeBucket();
    const a = new TenantStorage(asR2(bucket), cloud(TENANT_A));
    const k1 = await a.put(ogKey("curso", "v1"), "1");
    const k2 = await a.put(ogKey("curso", "v2"), "2");
    await expect(a.delete([k1, `t/${TENANT_B}/og/curso/v9.jpg`])).rejects.toThrow(TenantStorageViolation);
    expect(bucket.objects.size).toBe(2);
    await a.delete([k1, k2]);
    expect(bucket.objects.size).toBe(0);
  });
});
