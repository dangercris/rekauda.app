import { describe, expect, it } from "vitest";
import { HttpError } from "../http";
import { assertSameOrigin, isSafeMethod } from "./origin";

const url = new URL("https://demo-a.localhost/api/admin/logout");
const withOrigin = (origin: string | null) => new Request(url, { method: "POST", headers: origin === null ? {} : { origin } });

describe("assertSameOrigin", () => {
  it("accepts the exact origin of the resolved host", () => {
    expect(() => assertSameOrigin(withOrigin("https://demo-a.localhost"), url)).not.toThrow();
  });

  it.each([
    ["another tenant host", "https://demo-b.localhost"],
    ["a sibling subdomain of the same root", "https://evil.localhost"],
    ["another scheme", "http://demo-a.localhost"],
    ["another port", "https://demo-a.localhost:8443"],
    ["the literal null origin", "null"],
    ["an empty value", ""],
  ])("refuses %s with 403", (_label, origin) => {
    expect(() => assertSameOrigin(withOrigin(origin), url)).toThrow(expect.objectContaining({ status: 403, code: "forbidden_origin" }));
  });

  it("refuses a request without Origin", () => {
    expect(() => assertSameOrigin(withOrigin(null), url)).toThrow(HttpError);
  });
});

describe("isSafeMethod", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("treats %s as safe", (method) => expect(isSafeMethod(method)).toBe(true));
  it.each(["POST", "PUT", "PATCH", "DELETE"])("treats %s as state-changing", (method) => expect(isSafeMethod(method)).toBe(false));
});
