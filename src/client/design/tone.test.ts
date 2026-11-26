import { describe, expect, it } from "vitest";
import {
  AA,
  INK,
  SURFACE_DARK,
  SURFACE_LIGHT,
  WHITE,
  ambientColors,
  contrastRatio,
  eventTextColor,
  eventVars,
  hexToRgb,
  mix,
  normalizeHex,
  pickInk,
  relativeLuminance,
} from "./tone";

describe("normalizeHex / hexToRgb", () => {
  it("normalizes short, long and unprefixed hex", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("c81e3a")).toBe("#C81E3A");
    expect(normalizeHex(" #0B7A73 ")).toBe("#0B7A73");
  });

  it("rejects non-hex input", () => {
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });

  it("parses channels and falls back to black like the canvas", () => {
    expect(hexToRgb("#C81E3A")).toEqual([200, 30, 58]);
    expect(hexToRgb("nope")).toEqual([0, 0, 0]);
  });
});

describe("mix", () => {
  it("matches the canvas rounding", () => {
    expect(mix("#C81E3A", "#ffffff", 0.45)).toBe("#E18393");
    expect(mix("#E9A93B", "#000000", 0.42)).toBe("#876222");
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#FFFFFF");
  });
});

describe("luminance and contrast", () => {
  it("computes WCAG luminance", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#C81E3A")).toBeCloseTo(0.135, 3);
  });

  it("computes contrast ratios", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
});

describe("pickInk", () => {
  it("follows the canvas threshold (L > 0.36 -> ink, else white) for the canvas tones", () => {
    for (const tone of ["#C81E3A", "#3D4FA3", "#0B7A73", "#1E6B4E"]) expect(pickInk(tone)).toBe(WHITE);
    for (const tone of ["#E9A93B", "#F08A5D", "#F7C548"]) expect(pickInk(tone)).toBe(INK);
  });

  it("switches to ink when white would fail AA (0.19 < L <= 0.36)", () => {
    const tone = "#E0457A";
    expect(relativeLuminance(tone)).toBeGreaterThan(0.19);
    expect(relativeLuminance(tone)).toBeLessThanOrEqual(0.36);
    expect(contrastRatio(WHITE, tone)).toBeLessThan(AA);
    expect(pickInk(tone)).toBe(INK);
    expect(contrastRatio(INK, tone)).toBeGreaterThanOrEqual(AA);
  });

  it("always gives the higher-contrast option", () => {
    for (let v = 0; v <= 255; v += 15) {
      const hex = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      const best = Math.max(contrastRatio(WHITE, hex), contrastRatio(INK, hex));
      const picked = contrastRatio(pickInk(hex), hex);
      expect(picked >= AA || picked === best).toBe(true);
    }
  });
});

describe("eventTextColor", () => {
  it("keeps the canvas formula when it already passes", () => {
    expect(eventTextColor("#C81E3A", false)).toBe("#C81E3A");
    expect(eventTextColor("#E9A93B", false)).toBe("#876222");
    expect(eventTextColor("#C81E3A", true)).toBe("#E18393");
  });

  it("reaches 4.5:1 on the page surface for any tone", () => {
    for (const tone of ["#C81E3A", "#3D4FA3", "#0B7A73", "#F7C548", "#33CC99", "#8E7CC3", "#202020", "#FAFAFA"]) {
      expect(contrastRatio(eventTextColor(tone, false), SURFACE_LIGHT)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(eventTextColor(tone, true), SURFACE_DARK)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("eventVars", () => {
  it("produces the full var set for light and dark", () => {
    const light = eventVars("#c81e3a", false);
    expect(light["--ev"]).toBe("#C81E3A");
    expect(light["--ev-rgb"]).toBe("200,30,58");
    expect(light["--ev-ink"]).toBe(WHITE);
    expect(light["--ev-soft"]).toBe("rgba(200,30,58,0.12)");
    expect(light["--ev-bar"]).toBe("#C81E3A");
    const dark = eventVars("#C81E3A", true);
    expect(dark["--ev-soft"]).toBe("rgba(200,30,58,0.22)");
    expect(dark["--ev-text"]).toBe("#E18393");
    expect(dark["--ev-bar"]).toBe("#E18393");
  });

  it("falls back to the default tone for invalid input", () => {
    expect(eventVars("not-a-color", false)["--ev"]).toBe("#3D4FA3");
  });

  it("derives distinct ambient colors", () => {
    const { secondary, accent } = ambientColors("#3D4FA3");
    expect(secondary).not.toBe("#3D4FA3");
    expect(accent).not.toBe(secondary);
    expect(normalizeHex(secondary)).toBe(secondary);
  });
});
