import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, base64Url, randomCode, sha256Hex } from "./ids";
import { normalizeCode } from "./validation";

describe("randomCode", () => {
  it("has format XXX-XXX over the safe alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = randomCode();
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
      for (const c of code.replace("-", "")) expect(CODE_ALPHABET).toContain(c);
      expect(normalizeCode(code)).toBe(code);
    }
  });

  it("excludes look-alike characters", () => {
    for (const c of "01ILO") expect(CODE_ALPHABET).not.toContain(c);
  });

  it("is not constant", () => {
    expect(new Set(Array.from({ length: 50 }, randomCode)).size).toBeGreaterThan(40);
  });
});

describe("hashing helpers", () => {
  it("sha256Hex matches a known vector", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("base64Url is unpadded and url-safe", () => {
    expect(base64Url(Uint8Array.from([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(base64Url(Uint8Array.from([1]))).toBe("AQ");
  });
});
