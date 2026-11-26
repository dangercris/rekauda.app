/** Self-host password provider: constant-time compare on SHA-256 digests and a rate limited login that opens a D1 session. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { secretsMatch } from "./password";

afterEach(() => vi.restoreAllMocks());

describe("secretsMatch", () => {
  it("matches equal secrets and rejects different ones, including different lengths and prefixes", async () => {
    expect(await secretsMatch("clave-local", "clave-local")).toBe(true);
    expect(await secretsMatch("clave-local", "clave-locaL")).toBe(false);
    expect(await secretsMatch("clave", "clave-local")).toBe(false);
    expect(await secretsMatch("", "clave-local")).toBe(false);
  });

  it("always compares two 32-byte digests with timingSafeEqual, whatever the input lengths", async () => {
    const spy = vi.spyOn(crypto.subtle as unknown as { timingSafeEqual: (a: ArrayBuffer, b: ArrayBuffer) => boolean }, "timingSafeEqual");
    await secretsMatch("a", "a-much-longer-expected-secret");
    await secretsMatch("a-much-longer-given-secret-than-expected", "b");
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [a, b] of spy.mock.calls) {
      expect([a.byteLength, b.byteLength]).toEqual([32, 32]);
    }
  });
});
