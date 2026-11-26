import { afterEach, describe, expect, it, vi } from "vitest";
import { ogVersion } from "./og-card";
import { serveOgImage } from "./og-image";
import { ogKey, tenantPrefix } from "./storage/keys";
import { TENANT_A, TENANT_B } from "./test/d1-cloud";
import { COLLECTION_A, SHARED_SLUG, createHarness } from "./test/harness";

// The renderer is WASM and the fonts are binary assets: only the paths that serve an already stored card are exercised here.
const renderMock = vi.hoisted(() => vi.fn());
vi.mock("@cf-wasm/og/workerd", () => ({
  CustomFont: class {},
  cache: { setExecutionContext: () => undefined },
  render: renderMock,
}));
vi.mock("./fonts/Geist-Bold.ttf", () => ({ default: new ArrayBuffer(0) }));
vi.mock("./fonts/Geist-Medium.ttf", () => ({ default: new ArrayBuffer(0) }));

const ec = { waitUntil: () => undefined } as unknown as ExecutionContext;
const env = { IMAGES: {} } as never;
afterEach(() => {
  vi.restoreAllMocks();
  renderMock.mockReset();
});

describe("serveOgImage", () => {
  it("serves the stored card of the acting tenant and never reads another tenant's key", async () => {
    const h = createHarness();
    const version = (updatedAt: string) => ogVersion({ updated_at: updatedAt });
    const updated = (h.raw.sqlite.prepare("SELECT updated_at FROM collections WHERE id = ?").get(COLLECTION_A) as { updated_at: string }).updated_at;
    const keyA = tenantPrefix(TENANT_A) + ogKey(SHARED_SLUG, version(updated));
    const keyB = tenantPrefix(TENANT_B) + ogKey(SHARED_SLUG, version(updated));
    await h.bucket.put(keyA, "card-of-a");
    await h.bucket.put(keyB, "card-of-b");
    h.bucket.reads.length = 0;

    const url = new URL(`https://demo-b.localhost/api/og/${SHARED_SLUG}.jpg`);
    const res = await serveOgImage(new Request(url), h.b, env, ec, url, SHARED_SLUG);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("card-of-b");
    expect(h.bucket.reads).toEqual([keyB]);
    h.spy.assertAllScoped(TENANT_B);
  });

  it("answers 404 for a slug that only exists in another tenant without touching R2", async () => {
    const h = createHarness();
    h.raw.sqlite
      .prepare(
        `INSERT INTO collections (id, tenant_id, slug, title, description, options_json, deadline, created_at, updated_at)
         VALUES ('c0000000-0000-4000-8000-0000000000a1', ?, 'only-a', 'Title A', 'Invented.', '[]', '2026-12-31', '2026-11-26T00:00:00.000Z', '2026-11-26T00:00:00.000Z')`,
      )
      .run(TENANT_A);
    const url = new URL("https://demo-b.localhost/api/og/only-a.jpg");
    const res = await serveOgImage(new Request(url), h.b, env, ec, url, "only-a");
    expect(res.status).toBe(404);
    expect(h.bucket.reads).toEqual([]);
  });

  it("prunes old cards inside the acting tenant's prefix only, after storing the new one", async () => {
    const h = createHarness();
    renderMock.mockReturnValue({ asPng: async () => ({ image: new Uint8Array([1, 2, 3]) }) });
    const jpeg = { input: () => ({ output: async () => ({ image: () => new Response("jpeg").body, contentType: () => "image/jpeg" }) }) };
    const pending: Promise<unknown>[] = [];
    const waiting = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext;
    for (const tenant of [TENANT_A, TENANT_B]) {
      await h.bucket.put(`${tenantPrefix(tenant)}${ogKey(SHARED_SLUG, "old1")}`, `old-${tenant}`);
      await h.bucket.put(`${tenantPrefix(tenant)}${ogKey("other-slug", "keep")}`, `other-${tenant}`);
    }
    const url = new URL(`https://demo-b.localhost/api/og/${SHARED_SLUG}.jpg`);
    const res = await serveOgImage(new Request(url), h.b, { IMAGES: jpeg } as never, waiting, url, SHARED_SLUG);
    expect(res.status).toBe(200);
    await Promise.all(pending);
    const keys = [...h.bucket.objects.keys()];
    expect(keys).toContain(`${tenantPrefix(TENANT_A)}${ogKey(SHARED_SLUG, "old1")}`);
    expect(keys).not.toContain(`${tenantPrefix(TENANT_B)}${ogKey(SHARED_SLUG, "old1")}`);
    expect(keys).toContain(`${tenantPrefix(TENANT_B)}${ogKey("other-slug", "keep")}`);
    expect(keys.filter((k) => k.startsWith(`${tenantPrefix(TENANT_B)}og/${SHARED_SLUG}/`))).toHaveLength(1);
    expect(h.bucket.lists).toEqual([`${tenantPrefix(TENANT_B)}og/${SHARED_SLUG}/`]);
  });
});
