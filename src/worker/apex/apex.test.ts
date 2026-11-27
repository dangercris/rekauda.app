import { describe, expect, it } from "vitest";
import { serveApex } from "./apex";

// Invented values only.
const ROOT = "colegio-demo.example.test";
const MAP = { "/r/curso-demo": `https://curso-demo.${ROOT}/r/curso-demo` };
const call = (path: string, method = "GET", map: Record<string, string> = MAP) => serveApex(new Request(`https://${ROOT}${path}`, { method }), new URL(`https://${ROOT}${path}`), map);

describe("serveApex legacy redirect", () => {
  it.each(["GET", "HEAD"])("%s on the exact legacy path answers 302, no-store, query kept", async (method) => {
    const res = call("/r/curso-demo?x=1&y=a%20b", method);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://curso-demo.${ROOT}/r/curso-demo?x=1&y=a%20b`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts exactly one trailing slash and redirects to the same canonical target", () => {
    const res = call("/r/curso-demo/?x=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://curso-demo.${ROOT}/r/curso-demo?x=1`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(call("/r/curso-demo/", "HEAD").status).toBe(302);
    expect(call("/r/curso-demo/", "POST").status).toBe(404);
  });

  it("without a query the Location has none", () => expect(call("/r/curso-demo").headers.get("location")).toBe(MAP["/r/curso-demo"]));

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("%s on the legacy path is a plain 404, never a redirect", (method) => {
    const res = call("/r/curso-demo", method);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  // Exact match only: no normalisation of trailing slash, case, encoding or dot segments.
  it.each([
    ["two trailing slashes", "/r/curso-demo//"],
    ["trailing slash then segment", "/r/curso-demo/x"],
    ["bare double slash", "//"],
    ["extra segment", "/r/curso-demo/extra"],
    ["uppercase", "/R/curso-demo"],
    ["uppercase slug", "/r/Curso-Demo"],
    ["encoded hyphen", "/r/curso%2Ddemo"],
    ["encoded slash", "/r%2Fcurso-demo"],
    ["double slash", "//r/curso-demo"],
    ["unlisted slug", "/r/otro-curso"],
    ["admin", "/admin"],
    ["api", "/api/collections"],
    ["index.html", "/index.html"],
  ])("%s answers 404", (_label, path) => {
    const res = call(path);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("the redirect target is never the same URL the request came to (no loop)", () => {
    const res = call("/r/curso-demo/");
    expect(new URL(res.headers.get("location")!).host).not.toBe(ROOT);
  });

  it("an empty map answers 404 on the legacy path", () => expect(call("/r/curso-demo", "GET", {}).status).toBe(404));
  it("a prototype name is not a map hit", () => expect(call("/r/constructor").status).toBe(404));
});

describe("serveApex landing", () => {
  it.each(["GET", "HEAD"])("%s / serves the static landing with its own CSP", async (method) => {
    const res = call("/", method);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("is plain Spanish markup: no scripts, styles, links, em dashes or tenant data", async () => {
    const html = await call("/").text();
    expect(html).toContain('<html lang="es">');
    expect(html).not.toMatch(/<script|<style|style=|<link|<img|<form|<iframe|\son\w+=|https?:/i);
    expect(html).not.toMatch(/[—–]/);
    expect(html).not.toContain(ROOT);
  });

  it("POST / is a 404, and the landing is served with an empty map", () => {
    expect(call("/", "POST").status).toBe(404);
    expect(call("/", "GET", {}).status).toBe(200);
  });
});
