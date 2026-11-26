
import { describe, expect, it } from "vitest";
import headersRaw from "../../public/_headers?raw";
import { withPageHeaders } from "./og";

const headersFile = headersRaw;

/** Content-Security-Policy value of the first (`/*`) and the `/admin*` blocks of public/_headers. */
function cspByBlock(): { global: string; admin: string } {
  const lines = headersFile.split("\n");
  const values = lines
    .filter((line) => /^\s+Content-Security-Policy:/.test(line))
    .map((line) => line.replace(/^\s+Content-Security-Policy:\s*/, "").trim());
  return { global: values[0] ?? "", admin: values[1] ?? "" };
}

describe("Content-Security-Policy", () => {
  it("is identical in public/_headers (/*) and the Worker page headers", () => {
    const fromWorker = withPageHeaders(new Response("<html></html>")).headers.get("Content-Security-Policy");
    expect(fromWorker).toBe(cspByBlock().global);
  });

  it("is identical in public/_headers (/admin*) and the Worker admin page headers", () => {
    const admin = withPageHeaders(new Response("<html></html>"), false, true);
    expect(admin.headers.get("Content-Security-Policy")).toBe(cspByBlock().admin);
    expect(admin.headers.get("Cache-Control")).toBe("no-store");
    expect(headersFile).toMatch(/\/admin\*\n\s+! Cache-Control\n\s+Cache-Control: no-store/);
  });

  it("allows exactly what GA4 and Cloudflare Web Analytics need on public pages", () => {
    const csp = cspByBlock().global;
    expect(csp).toContain("script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com;");
    expect(csp).toContain(
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://cloudflareinsights.com;",
    );
    expect(csp).toContain("img-src 'self' blob: data: https://*.google-analytics.com https://*.googletagmanager.com;");
  });

  it("keeps the admin pages on the strict policy without Google", () => {
    const { admin } = cspByBlock();
    expect(admin).toContain("default-src 'self'");
    expect(admin).not.toMatch(/googletagmanager|google-analytics|analytics\.google|cloudflareinsights/);
  });
});
