import { describe, expect, it, vi } from "vitest";
import { ogVersion } from "./og-card";
import { buildOgMeta, escapeAttr, metaEntries, metaTags, publicOrigin, servePage, truncateDescription, withPageHeaders } from "./og";

const ID = "c0000000-0000-4000-8000-000000000001";
const base = { slug: "vestuario-musical", title: "Vestuario del musical", description: "Registra tu transferencia.", updated_at: "2026-11-26T06:00:00.000Z" };
const IMAGE = `https://x.test/api/og/vestuario-musical.jpg?v=${ogVersion(base)}`;

describe("truncateDescription", () => {
  it("keeps short text and collapses whitespace", () => {
    expect(truncateDescription("  hola \n  mundo ")).toBe("hola mundo");
  });

  it("cuts long text on a word boundary within 160 chars", () => {
    const long = "palabra ".repeat(60);
    const out = truncateDescription(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/palabr…$/);
  });

  it("hard-cuts a single huge token", () => {
    expect(truncateDescription("x".repeat(500)).length).toBe(160);
  });
});

describe("publicOrigin", () => {
  it("forces https for real hosts and keeps local dev origins", () => {
    expect(publicOrigin(new URL("http://rekauda.example.workers.dev/r/x"))).toBe("https://rekauda.example.workers.dev");
    expect(publicOrigin(new URL("http://localhost:8799/r/x"))).toBe("http://localhost:8799");
  });
});

describe("buildOgMeta", () => {
  it("builds title, description and canonical url", () => {
    expect(buildOgMeta(base, "https://x.test")).toEqual({
      title: "Vestuario del musical · 1.º Básica A",
      description: "Registra tu transferencia.",
      url: "https://x.test/r/vestuario-musical",
      image: IMAGE,
      imageAlt: "Vestuario del musical: datos de pago y fecha límite",
    });
  });

  it("changes the image url whenever the collection changes", () => {
    const later = buildOgMeta({ ...base, updated_at: "2026-11-27T10:00:00.000Z" }, "https://x.test");
    expect(later.image).not.toBe(IMAGE);
    expect(later.image).toMatch(/^https:\/\/x\.test\/api\/og\/vestuario-musical\.jpg\?v=1[0-9a-z]+$/);
  });
});

describe("meta tags", () => {
  it("always emits the generated card with its size and type", () => {
    const entries = metaEntries(buildOgMeta(base, "https://x.test"));
    expect(entries.map((e) => e.key)).toEqual([
      "description",
      "og:type",
      "og:title",
      "og:description",
      "og:url",
      "og:locale",
      "og:image",
      "og:image:secure_url",
      "og:image:type",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
      "twitter:card",
      "twitter:image",
    ]);
    const byKey = new Map(entries.map((e) => [e.key, e.content]));
    expect(byKey.get("og:image")).toBe(IMAGE);
    expect(byKey.get("og:image:width")).toBe("1200");
    expect(byKey.get("og:image:height")).toBe("630");
  });

  it("escapes every attribute value", () => {
    expect(escapeAttr(`a"b'c<d>&e`)).toBe("a&quot;b&#39;c&lt;d&gt;&amp;e");
    const tags = metaTags(buildOgMeta({ ...base, title: `"><script>alert(1)</script>`, description: `<img src=x onerror=1>` }, "https://x.test"));
    expect(tags).not.toContain("<script>");
    expect(tags).not.toContain("<img");
    expect(tags).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("withPageHeaders", () => {
  const shell = () => new Response("<html></html>", { headers: { "content-type": "text/html", ETag: '"abc"', "Last-Modified": "Wed, 01 Jan 2026 00:00:00 GMT" } });

  it("keeps the asset validators when the body is untouched", () => {
    const out = withPageHeaders(shell());
    expect(out.headers.get("ETag")).toBe('"abc"');
    expect(out.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("drops ETag and Last-Modified on rewritten responses", () => {
    const out = withPageHeaders(shell(), true);
    expect(out.headers.get("ETag")).toBeNull();
    expect(out.headers.get("Last-Modified")).toBeNull();
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("servePage", () => {
  it("serves the plain shell with page headers when the collection lookup throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = {
      ASSETS: { fetch: async () => new Response("<html><head></head></html>", { headers: { "content-type": "text/html" } }) },
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("D1_ERROR: boom");
            },
          }),
        }),
      },
    } as unknown as Env;
    const url = new URL("https://x.test/r/vestuario-musical");
    const res = await servePage(new Request(url), env, url, "vestuario-musical");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(await res.text()).not.toContain("og:title");
    const logged = JSON.parse(String(error.mock.calls[0]?.[0])) as { event: string; slug: string };
    expect(logged).toMatchObject({ event: "og_lookup_failed", slug: "vestuario-musical" });
    error.mockRestore();
  });
});
