import { describe, expect, it } from "vitest";
import { TtlCache } from "./cache";

function setup(maxEntries = 500) {
  const clock = { now: 1_000_000 };
  const cache = new TtlCache<string>({ now: () => clock.now, maxEntries });
  return { clock, cache };
}

describe("TtlCache", () => {
  it("distinguishes an absent entry from a cached miss", () => {
    const { cache } = setup();
    expect(cache.get("a")).toBeUndefined();
    cache.set("a", null);
    expect(cache.get("a")).toEqual({ value: null });
  });

  it("keeps hits for 60 seconds", () => {
    const { cache, clock } = setup();
    cache.set("a", "tenant");
    clock.now += 59_999;
    expect(cache.get("a")).toEqual({ value: "tenant" });
    clock.now += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("keeps misses for only 15 seconds", () => {
    const { cache, clock } = setup();
    cache.set("a", null);
    clock.now += 14_999;
    expect(cache.get("a")).toEqual({ value: null });
    clock.now += 1;
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the oldest entry beyond the bound", () => {
    const { cache } = setup(3);
    for (const k of ["a", "b", "c", "d"]) cache.set(k, k);
    expect(cache.get("a")).toBeUndefined();
    expect(["b", "c", "d"].map((k) => cache.get(k)?.value)).toEqual(["b", "c", "d"]);
    expect(cache.size).toBe(3);
  });

  it("is least-recently-used: a read protects an entry from eviction", () => {
    const { cache } = setup(3);
    for (const k of ["a", "b", "c"]) cache.set(k, k);
    expect(cache.get("a")).toEqual({ value: "a" });
    cache.set("d", "d");
    expect(cache.get("b")).toBeUndefined();
    expect(["a", "c", "d"].map((k) => cache.get(k)?.value)).toEqual(["a", "c", "d"]);
  });

  it("does not extend the TTL when an entry is read", () => {
    const { cache, clock } = setup();
    cache.set("a", "1");
    clock.now += 40_000;
    cache.get("a");
    clock.now += 20_000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("refreshes an entry that is written again", () => {
    const { cache, clock } = setup(2);
    cache.set("a", "1");
    cache.set("b", "2");
    clock.now += 30_000;
    cache.set("a", "3");
    cache.set("c", "4");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual({ value: "3" });
    clock.now += 40_000;
    expect(cache.get("a")).toEqual({ value: "3" });
  });

  it("keeps misses in a separate bounded cache so unknown hosts cannot evict real tenants", () => {
    const clock = { now: 1_000_000 };
    const cache = new TtlCache<string>({ now: () => clock.now, maxEntries: 3, maxMisses: 2 });
    for (const k of ["a", "b", "c"]) cache.set(k, k);
    for (let i = 0; i < 50; i++) cache.set(`unknown-${i}`, null);
    expect(["a", "b", "c"].map((k) => cache.get(k)?.value)).toEqual(["a", "b", "c"]);
    expect(cache.get("unknown-0")).toBeUndefined();
    expect(cache.get("unknown-49")).toEqual({ value: null });
    expect(cache.size).toBe(5);
  });

  it("moves a key between the hit and miss caches when its value changes", () => {
    const { cache } = setup();
    cache.set("a", null);
    cache.set("a", "tenant");
    expect(cache.get("a")).toEqual({ value: "tenant" });
    cache.set("a", null);
    expect(cache.get("a")).toEqual({ value: null });
    expect(cache.size).toBe(1);
  });

  it("defaults to 500 entries", () => {
    const cache = new TtlCache<number>();
    for (let i = 0; i < 520; i++) cache.set(String(i), i);
    expect(cache.size).toBe(500);
    expect(cache.get("0")).toBeUndefined();
    expect(cache.get("519")).toEqual({ value: 519 });
  });
});
