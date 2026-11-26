import { describe, expect, it } from "vitest";
import { coverKey, coverKeyFromPath, coverUrl } from "./covers";

const ID = "c0000000-0000-4000-8000-000000000001";
const HASH = "b54c12801dcd129e";

describe("cover keys", () => {
  it("builds content-addressed keys from the first 16 hex chars", () => {
    expect(coverKey(ID, "b54c12801dcd129e99999999", "png")).toBe(`covers/${ID}/${HASH}.png`);
  });

  it("coverUrl strips the covers/ prefix, or is null", () => {
    expect(coverUrl(`covers/${ID}/${HASH}.webp`)).toBe(`/api/covers/${ID}/${HASH}.webp`);
    expect(coverUrl(null)).toBeNull();
    expect(coverUrl(`receipts/${ID}.jpg`)).toBeNull();
  });

  it("coverUrl and coverKeyFromPath round-trip", () => {
    const key = `covers/${ID}/${HASH}.jpg`;
    const path = coverUrl(key)?.slice("/api/covers/".length) ?? "";
    expect(coverKeyFromPath(path)).toEqual({ key, contentType: "image/jpeg" });
  });
});

describe("cover path guard", () => {
  it.each([
    [`${ID}/${HASH}.jpg`, "image/jpeg"],
    [`${ID}/${HASH}.png`, "image/png"],
    [`${ID}/${HASH}.webp`, "image/webp"],
  ])("maps %s", (path, contentType) => {
    expect(coverKeyFromPath(path)).toEqual({ key: `covers/${path}`, contentType });
  });

  it.each([
    "",
    `${ID}/${HASH}.pdf`,
    `${ID}/${HASH}.svg`,
    `${ID}/${HASH}`,
    `${ID}/short.png`,
    `${ID}/${HASH.toUpperCase()}.png`,
    `${ID}/${HASH}.png/extra`,
    `../receipts/${ID}.jpg`,
    `receipts/ff1435d6-efd5-4d56-99fb-818cd08c7a78.jpg`,
    `covers/${ID}/${HASH}.png`,
    `${ID}/../${HASH}.png`,
    `${ID}%2F${HASH}.png`,
    `not-a-uuid/${HASH}.png`,
    `${ID}/${HASH}.png\n`,
  ])("refuses %j", (path) => {
    expect(coverKeyFromPath(path)).toBeNull();
  });
});
