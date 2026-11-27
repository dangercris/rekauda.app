import { describe, expect, it } from "vitest";
import { legacyRedirectsValid, parseLegacyRedirects } from "./legacy-redirects";

// Invented values only.
const ROOT = "colegio-demo.example.test";
const good = { "/r/curso-demo": `https://curso-demo.${ROOT}/r/curso-demo` };

describe("parseLegacyRedirects", () => {
  it("returns a valid map unchanged (as a copy)", () => {
    const parsed = parseLegacyRedirects(good, ROOT);
    expect(parsed).toEqual(good);
    expect(parsed).not.toBe(good);
  });

  it.each([[undefined], [null], [{}]])("an absent or empty map (%j) is an empty map", (raw) => {
    expect(parseLegacyRedirects(raw, ROOT)).toEqual({});
    expect(legacyRedirectsValid(raw, ROOT)).toBe(raw === undefined || raw === null ? false : true);
  });

  it.each([["a string", JSON.stringify(good)], ["an array", [good]], ["a number", 1], ["true", true]])("%s is refused as a whole", (_label, raw) => {
    expect(parseLegacyRedirects(raw, ROOT)).toEqual({});
    expect(legacyRedirectsValid(raw, ROOT)).toBe(false);
  });

  it("accepts 20 entries and refuses 21", () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`/r/curso-${i}`, `https://curso-${i}.${ROOT}/r/curso-${i}`]));
    expect(Object.keys(parseLegacyRedirects(many(20), ROOT))).toHaveLength(20);
    expect(parseLegacyRedirects(many(21), ROOT)).toEqual({});
  });

  const bad: [string, Record<string, unknown>][] = [
    ["protocol-relative target", { "/r/curso-demo": `//curso-demo.${ROOT}/r/curso-demo` }],
    ["other host", { "/r/curso-demo": "https://curso-demo.evil.example.test/r/curso-demo" }],
    ["root as a suffix of another host", { "/r/curso-demo": `https://curso-demo.${ROOT}.evil.example.test/r/curso-demo` }],
    ["userinfo trick", { "/r/curso-demo": `https://evil.example.test@curso-demo.${ROOT}/r/curso-demo` }],
    ["different slug in the target host", { "/r/curso-demo": `https://otro.${ROOT}/r/curso-demo` }],
    ["different slug in the target path", { "/r/curso-demo": `https://curso-demo.${ROOT}/r/otro` }],
    ["http target", { "/r/curso-demo": `http://curso-demo.${ROOT}/r/curso-demo` }],
    ["target with a trailing slash", { "/r/curso-demo": `https://curso-demo.${ROOT}/r/curso-demo/` }],
    ["target with a query", { "/r/curso-demo": `https://curso-demo.${ROOT}/r/curso-demo?x=1` }],
    ["target with a port", { "/r/curso-demo": `https://curso-demo.${ROOT}:8443/r/curso-demo` }],
    ["target with a backslash", { "/r/curso-demo": `https://curso-demo.${ROOT}\\r/curso-demo` }],
    ["uppercase target", { "/r/curso-demo": `https://Curso-Demo.${ROOT}/r/curso-demo` }],
    ["non-string target", { "/r/curso-demo": 7 }],
    ["encoded slash in the key", { "/r/curso%2fdemo": `https://curso%2fdemo.${ROOT}/r/curso%2fdemo` }],
    ["dot-dot in the key", { "/r/..": `https://...${ROOT}/r/..` }],
    ["trailing slash in the key", { "/r/curso-demo/": `https://curso-demo.${ROOT}/r/curso-demo` }],
    ["double slash in the key", { "/r//curso-demo": `https://curso-demo.${ROOT}/r/curso-demo` }],
    ["uppercase key", { "/r/Curso-Demo": `https://curso-demo.${ROOT}/r/curso-demo` }],
    ["key outside /r/", { "/admin": `https://admin.${ROOT}/r/admin` }],
    ["key with no slug", { "/r/": `https://.${ROOT}/r/` }],
    ["slug over 48 characters", { [`/r/${"a".repeat(49)}`]: `https://${"a".repeat(49)}.${ROOT}/r/${"a".repeat(49)}` }],
    ["slug with a double hyphen", { "/r/cur--so": `https://cur--so.${ROOT}/r/cur--so` }],
    ["slug starting with a hyphen", { "/r/-curso": `https://-curso.${ROOT}/r/-curso` }],
  ];
  it.each(bad)("refuses %s", (_label, map) => {
    expect(parseLegacyRedirects(map, ROOT)).toEqual({});
    expect(legacyRedirectsValid(map, ROOT)).toBe(false);
  });

  it("one bad entry empties the whole map (fail closed)", () => {
    const mixed = { ...good, "/r/otro": "https://evil.example.test/r/otro" };
    expect(parseLegacyRedirects(mixed, ROOT)).toEqual({});
  });

  it.each([[""], ["colegio-demo.example.test/"], ["Colegio-Demo.example.test"], ["https://colegio-demo.example.test"], [undefined], [7]])("a bad root (%j) yields an empty map", (root) => {
    expect(parseLegacyRedirects(good, root)).toEqual({});
  });

  it("does not trust prototype keys", () => {
    const parsed = parseLegacyRedirects(JSON.parse('{"__proto__":"x"}'), ROOT);
    expect(parsed).toEqual({});
  });
});
