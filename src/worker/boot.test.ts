import { describe, expect, it } from "vitest";
import type { ConfigResponse } from "../shared/api";
import { bootJson, renderShell, serveShell, servePage } from "./boot";
import type { CloudEnv } from "./env";
import { toPublicConfig } from "./public-config";
import { withInstance } from "./test/config";
import { TENANT_A, TENANT_B } from "./test/d1-cloud";
import { createHarness } from "./test/harness";

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>Static title</title><meta name="description" content="Static description"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`;
const html = (body = SHELL) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ETag: '"x"' } });
const hostile = `</script><script>alert(1)</script><!-- "' &  `;

const configA = toPublicConfig(withInstance({ schoolName: "School A", classShortName: "Class A" }), "multi");

describe("toPublicConfig", () => {
  it("exposes exactly the public contract and nothing internal", () => {
    expect(Object.keys(configA).sort()).toEqual(
      ["analytics", "auth", "banks", "className", "classMark", "classShortName", "defaultTone", "earliestTransferDate", "schoolName", "treasury"].sort(),
    );
    expect(Object.keys(configA.treasury).sort()).toEqual(["accountNumber", "accountType", "bank", "deunaUrl", "helpUrl", "holder", "holderId", "qrUrl"]);
  });

  it("maps the tenancy mode to the admin sign-in mode", () => {
    expect(toPublicConfig(withInstance({}), "single").auth).toEqual({ mode: "password" });
    expect(toPublicConfig(withInstance({}), "multi").auth).toEqual({ mode: "magic_link" });
  });
});

describe("bootJson", () => {
  it("never lets a tenant string close the script element or open a comment", () => {
    const out = bootJson({ ...configA, schoolName: hostile });
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toContain("<");
    expect(out).not.toContain(" ");
    expect((JSON.parse(out) as ConfigResponse).schoolName).toBe(hostile);
  });
});

describe("renderShell", () => {
  it("sets title and description and appends the boot JSON before the client scripts run", async () => {
    const out = await renderShell(html(), configA, { title: "T", description: "D" }).text();
    expect(out).toContain("<title>T</title>");
    expect(out).toContain('<meta name="description" content="D">');
    const script = /<script type="application\/json" id="rekauda-config">([\s\S]*?)<\/script>/.exec(out);
    expect((JSON.parse(script?.[1] ?? "null") as ConfigResponse).schoolName).toBe("School A");
    expect(out.indexOf('id="rekauda-config"')).toBeLessThan(out.indexOf("</head>"));
    expect(out.match(/id="rekauda-config"/g)).toHaveLength(1);
  });

  it("escapes hostile title, description and config values", async () => {
    const out = await renderShell(html(), { ...configA, schoolName: hostile }, { title: hostile, description: hostile }).text();
    expect(out.match(/<script/g)).toHaveLength(2);
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("&lt;/script&gt;");
  });

  it("escapes quotes and angle brackets in the description attribute and angle brackets in the title", async () => {
    const out = await renderShell(html(), configA, { title: `a'b"c<d`, description: `a'b"c<d>&` }).text();
    expect(out).toContain('content="a&#39;b&quot;c&lt;d&gt;&amp;"');
    expect(out).toContain("<title>a'b\"c&lt;d</title>");
    expect(out).not.toContain("c<d");
  });

  it("can drop preview tags the shell already had", async () => {
    const withOg = html(SHELL.replace("</head>", '<meta property="og:title" content="old"></head>'));
    const out = await renderShell(withOg, configA, { title: "T", description: "D", headTags: '<meta property="og:title" content="new">' }).text();
    expect(out.match(/og:title/g)).toHaveLength(1);
    expect(out).toContain('content="new"');
  });
});

describe("serveShell", () => {
  const assets = (seen: string[], response: () => Response = html) =>
    ({ TENANCY: "multi", ASSETS: { fetch: async (r: Request) => (seen.push(new URL(r.url).pathname), response()) } }) as unknown as Pick<CloudEnv, "ASSETS" | "TENANCY">;

  it("serves / with the tenant title, boot JSON and the public CSP", async () => {
    const h = createHarness();
    const seen: string[] = [];
    const res = await serveShell(new Request("https://demo-a.localhost/"), assets(seen), h.a, new URL("https://demo-a.localhost/"), "home");
    const body = await res.text();
    expect(seen).toEqual(["/"]);
    expect(body).toContain("<title>Recaudaciones Demo A</title>");
    expect(body).toContain("Demo School A");
    expect(body).not.toContain("Demo School B");
    expect(res.headers.get("Content-Security-Policy")).toContain("googletagmanager");
    expect(res.headers.get("ETag")).toBeNull();
  });

  it("serves /admin from the admin shell with the strict CSP and no-store", async () => {
    const h = createHarness();
    const seen: string[] = [];
    const res = await serveShell(new Request("https://demo-b.localhost/admin"), assets(seen), h.b, new URL("https://demo-b.localhost/admin"), "admin");
    const body = await res.text();
    expect(seen).toEqual(["/admin"]);
    expect(body).toContain("<title>Tesorería Demo B</title>");
    expect(body).toContain("Demo School B");
    expect(res.headers.get("Content-Security-Policy")).not.toMatch(/googletagmanager|google-analytics/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns non-HTML or failing asset responses untouched", async () => {
    const h = createHarness();
    const res = await serveShell(new Request("https://x.test/"), assets([], () => new Response("nope", { status: 404 })), h.a, new URL("https://x.test/"), "home");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("nope");
  });

  it("answers HEAD with the page headers and no boot JSON body", async () => {
    const h = createHarness();
    const env = { TENANCY: "multi", ASSETS: { fetch: async () => new Response(null, { headers: { "content-type": "text/html" } }) } } as unknown as Pick<CloudEnv, "ASSETS" | "TENANCY">;
    const res = await serveShell(new Request("https://demo-a.localhost/", { method: "HEAD" }), env, h.a, new URL("https://demo-a.localhost/"), "home");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(await res.text()).toBe("");
  });

  it("hands anything other than GET or HEAD to the assets", async () => {
    const h = createHarness();
    const seen: string[] = [];
    const res = await serveShell(new Request("https://x.test/", { method: "POST" }), assets(seen, () => new Response("asset")), h.a, new URL("https://x.test/"), "home");
    expect(await res.text()).toBe("asset");
    expect(seen).toEqual(["/"]);
  });
});

describe("servePage boot JSON", () => {
  it("adds the tenant's boot JSON and preview tags to /r/<slug>, and only that tenant's", async () => {
    const h = createHarness();
    const env = { TENANCY: "multi", ASSETS: { fetch: async () => html() } } as unknown as Pick<CloudEnv, "ASSETS" | "TENANCY">;
    const url = new URL("https://demo-a.localhost/r/demo-collection");
    const body = await (await servePage(new Request(url), env, h.a, url, "demo-collection")).text();
    expect(body).toContain('id="rekauda-config"');
    expect(body).toContain("Demo School A");
    expect(body).toContain("Demo collection A");
    expect(body).not.toMatch(/Demo School B|Demo collection B/);
    expect([TENANT_A, TENANT_B].some((id) => body.includes(id))).toBe(false);
    h.spy.assertAllScoped(TENANT_A);
  });
});
