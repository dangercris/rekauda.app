import { describe, expect, it } from "vitest";
import { hexToRgb, rgbToHsl } from "../../design";
import { suggestToneFromPixels } from "./toneSuggest";

/** RGBA buffer from [color, count] runs. */
function pixels(...runs: Array<[readonly [number, number, number, number?], number]>): Uint8ClampedArray {
  const out: number[] = [];
  for (const [[r, g, b, a = 255], count] of runs) for (let i = 0; i < count; i += 1) out.push(r, g, b, a);
  return new Uint8ClampedArray(out);
}

const hue = (hex: string): number => rgbToHsl(hexToRgb(hex)).h;

describe("suggestToneFromPixels", () => {
  it("picks the dominant saturated hue and ignores near-white and near-black", () => {
    const data = pixels([[250, 250, 250], 600], [[5, 5, 8], 300], [[200, 30, 58], 80], [[40, 90, 200], 20]);
    const tone = suggestToneFromPixels(data);
    expect(tone).toMatch(/^#[0-9A-F]{6}$/);
    expect(Math.abs(hue(tone ?? "#000000") - hue("#C81E3A"))).toBeLessThan(12);
  });

  it("returns null for grayscale images or almost no color", () => {
    expect(suggestToneFromPixels(pixels([[128, 128, 128], 500], [[240, 240, 240], 500]))).toBeNull();
    expect(suggestToneFromPixels(pixels([[255, 255, 255], 999], [[200, 30, 58], 1]))).toBeNull();
    expect(suggestToneFromPixels(new Uint8ClampedArray())).toBeNull();
  });

  it("skips transparent pixels", () => {
    const data = pixels([[0, 160, 150, 0], 900], [[60, 80, 170], 100]);
    expect(Math.abs(hue(suggestToneFromPixels(data) ?? "#000000") - hue("#3C50AA"))).toBeLessThan(12);
  });

  it("lands in a usable lightness range for buttons", () => {
    const pastel = suggestToneFromPixels(pixels([[255, 182, 193], 100]));
    const { l } = rgbToHsl(hexToRgb(pastel ?? "#000000"));
    expect(l).toBeGreaterThanOrEqual(0.29);
    expect(l).toBeLessThanOrEqual(0.53);
  });
});
