import { describe, expect, it } from "vitest";
import { serveDeunaQr } from "./assets";
import { buildContext } from "./context";
import { asD1 } from "./test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "./test/d1-cloud";
import { withInstance, TEST_INSTANCE } from "./test/config";
import { FakeBucket, asR2 } from "./test/r2-fake";
import { tenantOf } from "./test/harness";

const qrConfig = (ext: string) => withInstance({ treasury: { ...TEST_INSTANCE.treasury, qrUrl: `/api/assets/deuna-qr.${ext}?v=abc` } });

function setup(ext = "png") {
  const bucket = new FakeBucket();
  const bindings = { db: asD1(createCloudTestDb({ seed: true })), files: asR2(bucket) };
  return {
    bucket,
    a: buildContext(tenantOf(TENANT_A, "demo-a"), bindings, qrConfig(ext)),
    b: buildContext(tenantOf(TENANT_B, "demo-b"), bindings, withInstance({})),
  };
}
const get = (path: string, method = "GET") => new Request(`https://demo-a.localhost${path}`, { method });

describe("serveDeunaQr", () => {
  it("serves the tenant's own QR from its prefix with safe, cacheable headers", async () => {
    const { bucket, a } = setup();
    bucket.objects.set(`t/${TENANT_A}/assets/deuna-qr.png`, "PNGBYTES");
    const res = await serveDeunaQr(get("/api/assets/deuna-qr.png?v=abc"), a, "png");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PNGBYTES");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(bucket.reads).toEqual([`t/${TENANT_A}/assets/deuna-qr.png`]);
  });

  it("caches briefly when the version is missing or stale", async () => {
    const { bucket, a } = setup();
    bucket.objects.set(`t/${TENANT_A}/assets/deuna-qr.png`, "x");
    expect((await serveDeunaQr(get("/api/assets/deuna-qr.png"), a, "png")).headers.get("Cache-Control")).toBe("public, max-age=300");
    expect((await serveDeunaQr(get("/api/assets/deuna-qr.png?v=old"), a, "png")).headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("answers HEAD without a body", async () => {
    const { bucket, a } = setup();
    bucket.objects.set(`t/${TENANT_A}/assets/deuna-qr.png`, "x");
    const res = await serveDeunaQr(get("/api/assets/deuna-qr.png?v=abc", "HEAD"), a, "png");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("is a plain 404 when the QR object is missing (the page shows no QR, nothing breaks)", async () => {
    const { a } = setup();
    expect((await serveDeunaQr(get("/api/assets/deuna-qr.png"), a, "png")).status).toBe(404);
  });

  it("never serves another tenant's QR and never reads its key", async () => {
    const { bucket, a, b } = setup();
    bucket.objects.set(`t/${TENANT_A}/assets/deuna-qr.png`, "A-QR");
    const res = await serveDeunaQr(get("/api/assets/deuna-qr.png?v=abc"), b, "png");
    expect(res.status).toBe(404);
    expect(bucket.reads).toEqual([]);
    expect(await (await serveDeunaQr(get("/api/assets/deuna-qr.png?v=abc"), a, "png")).text()).toBe("A-QR");
  });

  it("only serves the extension the tenant config points at", async () => {
    const { bucket, a } = setup("png");
    bucket.objects.set(`t/${TENANT_A}/assets/deuna-qr.webp`, "W");
    expect((await serveDeunaQr(get("/api/assets/deuna-qr.webp"), a, "webp")).status).toBe(404);
    expect(bucket.reads).toEqual([]);
  });
});
