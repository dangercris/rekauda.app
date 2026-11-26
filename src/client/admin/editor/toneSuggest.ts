/**
 * "Sugerir desde la portada": picks a dominant, saturated color from the cover so the collection tone
 * matches its photo. The analysis is a pure function over RGBA pixel data (unit tested); the canvas
 * wrapper only downsamples the image.
 */
import { hslToRgb, rgbToHex, rgbToHsl, type Rgb } from "../../design";

export interface ToneSuggestOptions {
  /** Ignore pixels darker than this lightness (near black). Default 0.12. */
  minLightness?: number | undefined;
  /** Ignore pixels lighter than this lightness (near white). Default 0.88. */
  maxLightness?: number | undefined;
  /** Ignore greyish pixels below this HSL saturation. Default 0.28. */
  minSaturation?: number | undefined;
  /** Minimum share of qualifying pixels (0..1) to trust the result. Default 0.02. */
  minShare?: number | undefined;
}

const BUCKETS = 24;

/**
 * Returns `#RRGGBB` or null when the image has no usable color (black and white photo, a logo on white).
 * `data` is RGBA as returned by `getImageData().data`.
 */
export function suggestToneFromPixels(data: ArrayLike<number>, options: ToneSuggestOptions = {}): string | null {
  const minL = options.minLightness ?? 0.12;
  const maxL = options.maxLightness ?? 0.88;
  const minS = options.minSaturation ?? 0.28;
  const minShare = options.minShare ?? 0.02;

  const weight = new Array<number>(BUCKETS).fill(0);
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  let total = 0;
  let qualifying = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    if (alpha < 128) continue;
    total += 1;
    const rgb: Rgb = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    const { h, s, l } = rgbToHsl(rgb);
    if (l < minL || l > maxL || s < minS) continue;
    qualifying += 1;
    // Favor vivid mid-tones: they make the best buttons and ambient light.
    const w = s * (1 - Math.abs(l - 0.5) * 1.2);
    const bucket = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    weight[bucket] = (weight[bucket] ?? 0) + w;
    const sum = sums[bucket];
    if (sum) {
      sum[0] = (sum[0] ?? 0) + rgb[0] * w;
      sum[1] = (sum[1] ?? 0) + rgb[1] * w;
      sum[2] = (sum[2] ?? 0) + rgb[2] * w;
    }
  }

  if (total === 0 || qualifying / total < minShare) return null;

  // Strongest hue, merged with its two neighbors so a gradient is not split across buckets.
  let best = 0;
  let bestScore = -1;
  for (let b = 0; b < BUCKETS; b += 1) {
    const score = (weight[b] ?? 0) + 0.5 * ((weight[(b + BUCKETS - 1) % BUCKETS] ?? 0) + (weight[(b + 1) % BUCKETS] ?? 0));
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  const w = weight[best] ?? 0;
  const sum = sums[best];
  if (w <= 0 || !sum) return null;
  const average: Rgb = [(sum[0] ?? 0) / w, (sum[1] ?? 0) / w, (sum[2] ?? 0) / w];

  // Keep the hue, but land in a range that works as a button fill and as text on the page.
  const hsl = rgbToHsl(average);
  const tuned = { h: hsl.h, s: Math.min(0.9, Math.max(0.45, hsl.s)), l: Math.min(0.52, Math.max(0.3, hsl.l)) };
  return rgbToHex(hslToRgb(tuned));
}

/** Downsamples the image to at most 64 px and runs `suggestToneFromPixels`. Null when it cannot be read. */
export async function suggestToneFromImage(source: Blob | string, options?: ToneSuggestOptions): Promise<string | null> {
  const image = await loadImage(source);
  if (!image) return null;
  try {
    const scale = Math.min(1, 64 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image.source, 0, 0, width, height);
    return suggestToneFromPixels(ctx.getImageData(0, 0, width, height).data, options);
  } catch {
    return null;
  } finally {
    image.close();
  }
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function loadImage(source: Blob | string): Promise<LoadedImage | null> {
  if (typeof source !== "string" && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to <img>.
    }
  }
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const release = (): void => {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  };
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: release };
  } catch {
    release();
    return null;
  }
}
