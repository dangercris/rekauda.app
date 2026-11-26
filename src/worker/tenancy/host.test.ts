import { describe, expect, it } from "vitest";
import { RESERVED_SUBDOMAINS, isValidSlug, normalizeHost, parseHost } from "./host";

const ROOT = "rekauda.example";

describe("normalizeHost", () => {
  it("lowercases, strips the port and the trailing dot", () => {
    expect(normalizeHost("Curso-A.Rekauda.Example")).toBe("curso-a.rekauda.example");
    expect(normalizeHost("curso-a.rekauda.example:8787")).toBe("curso-a.rekauda.example");
    expect(normalizeHost("curso-a.rekauda.example.")).toBe("curso-a.rekauda.example");
    expect(normalizeHost("  CURSO-A.localhost.:443 ")).toBe("curso-a.localhost");
  });

  it.each(["ｋappa.rekauda.example", "\u212Aappa.rekauda.example", "\u0130dentity.rekauda.example", "kappa.rekauda.example:0", "kappa.rekauda.example:65536", "kappa.rekauda.example:99999", "xn--e1afmkfd.rekauda.example\u0000", "é.example"])(
    "rejects non-ASCII hosts and out-of-range ports: %j",
    (raw) => {
      expect(normalizeHost(raw)).toBeNull();
    },
  );

  it("accepts the port range edges", () => {
    expect(normalizeHost("a.example:1")).toBe("a.example");
    expect(normalizeHost("a.example:65535")).toBe("a.example");
  });

  it.each(["", " ", ".", "a..b", "-a.example", "a-.example", "a_b.example", "a b.example", "[::1]", "user@a.example", "a.example:", "a.example:80x", "a.example/path", `${"x".repeat(64)}.example`])(
    "fails closed on malformed host %j",
    (raw) => {
      expect(normalizeHost(raw)).toBeNull();
    },
  );
});

describe("parseHost", () => {
  it("resolves a single label under the root domain", () => {
    expect(parseHost("curso-a.rekauda.example", ROOT)).toEqual({ kind: "subdomain", slug: "curso-a", hostname: "curso-a.rekauda.example" });
    expect(parseHost("CURSO-B.Rekauda.Example.:8787", ROOT)).toEqual({ kind: "subdomain", slug: "curso-b", hostname: "curso-b.rekauda.example" });
  });

  it("supports <slug>.localhost for local development", () => {
    expect(parseHost("demo-a.localhost:8799", "localhost")).toEqual({ kind: "subdomain", slug: "demo-a", hostname: "demo-a.localhost" });
    expect(parseHost("localhost", "localhost")).toEqual({ kind: "apex" });
  });

  it("treats the apex and www as the apex", () => {
    expect(parseHost("rekauda.example", ROOT)).toEqual({ kind: "apex" });
    expect(parseHost("WWW.rekauda.example.", ROOT)).toEqual({ kind: "apex" });
  });

  it("rejects every reserved label even when a tenant row exists", () => {
    for (const label of RESERVED_SUBDOMAINS) {
      if (label === "www") continue;
      expect(parseHost(`${label}.${ROOT}`, ROOT)).toEqual({ kind: "reserved", label });
    }
    expect([...RESERVED_SUBDOMAINS]).toEqual(
      expect.arrayContaining(["www", "admin", "api", "app", "mail", "in", "static", "assets", "cdn", "status", "docs", "help", "login", "auth", "billing", "cloud", "dev", "staging", "test", "demo", "support", "security", "abuse", "postmaster", "webmaster", "smtp", "imap", "pop", "ns1", "ns2", "blog", "account", "console", "portal", "signup", "rekauda", "autodiscover"]),
    );
  });

  it("treats hosts outside the root domain as custom domains", () => {
    expect(parseHost("pagos.colegio.example:443", ROOT)).toEqual({ kind: "custom", hostname: "pagos.colegio.example" });
    expect(parseHost("notrekauda.example", ROOT)).toEqual({ kind: "custom", hostname: "notrekauda.example" });
  });

  it("rejects nested subdomains and malformed input", () => {
    expect(parseHost("a.b.rekauda.example", ROOT)).toEqual({ kind: "invalid" });
    expect(parseHost("", ROOT)).toEqual({ kind: "invalid" });
    expect(parseHost("curso a.rekauda.example", ROOT)).toEqual({ kind: "invalid" });
  });

  it("fails closed when the root domain itself is malformed", () => {
    expect(parseHost("curso-a.rekauda.example", "")).toEqual({ kind: "invalid" });
    expect(parseHost("curso-a.rekauda.example", "bad root")).toEqual({ kind: "invalid" });
  });

  it("compares the root domain normalised", () => {
    expect(parseHost("curso-a.rekauda.example", " Rekauda.Example. ")).toEqual({ kind: "subdomain", slug: "curso-a", hostname: "curso-a.rekauda.example" });
  });
});

describe("isValidSlug", () => {
  it("accepts DNS-safe lowercase slugs", () => {
    expect(isValidSlug("curso-a")).toBe(true);
    expect(isValidSlug("club-azul-2")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a".repeat(40))).toBe(true);
  });

  it.each(["", "ab", "a".repeat(41), "Curso-A", "-curso", "curso-", "cur--so", "cur_so", "cursó", "cur so", "cur.so", ...[...RESERVED_SUBDOMAINS]])(
    "rejects %j",
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});
