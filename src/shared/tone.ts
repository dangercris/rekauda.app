/**
 * Event tone math. Pure functions, no DOM.
 *
 * `eventVars` reproduces the design canvas `vars()` function (Recaudo Escolar):
 *   L      = relative luminance of the tone (WCAG, 0.03928 threshold as in the canvas)
 *   ink    = L > 0.36 ? #0E1117 : #FFFFFF
 *   text   = dark ? mix(tone, white, .45) : (L > 0.18 ? mix(tone, black, .42) : tone)
 *   soft   = rgba(tone, dark ? .22 : .12)
 * plus two safety nets the canvas does not have (they only kick in for tones the canvas never showed):
 *   - `--ev-ink` falls back to the higher-contrast option when the canvas pick is under 4.5:1
 *     (tones with 0.19 < L <= 0.36, where white text would fail AA).
 *   - `--ev-text` is pushed toward black (light) or white (dark) until it reaches 4.5:1 on the page surface.
 * The secondary and accent ambient colors (`--ev2`, `--ev3`) are derived by hue rotation because the API
 * only stores the main tone.
 */

export type Rgb = readonly [r: number, g: number, b: number];

export const INK = "#0E1117";
export const WHITE = "#FFFFFF";
export const BLACK = "#000000";
/** Page backgrounds (light / dark) used for text contrast checks. */
export const SURFACE_LIGHT = "#EEF0F4";
/** Darkest likely surface for event text in dark mode is the page; the lightest is a strong glass. */
export const SURFACE_DARK = "#22242E";
export const DEFAULT_TONE = "#3D4FA3";
export const AA = 4.5;

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalizes `#abc`, `abc`, `#AABBCC` to uppercase `#AABBCC`. Returns null when the input is not a hex color. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const match = HEX_RE.exec(input.trim());
  const body = match?.[1];
  if (!body) return null;
  const full = body.length === 3 ? body.replace(/./g, (ch) => ch + ch) : body;
  return `#${full.toUpperCase()}`;
}

/** Parses a hex color into 0..255 channels. Invalid input yields black, like the canvas (`parseInt(...) || 0`). */
export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  const n = normalized ? Number.parseInt(normalized.slice(1), 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const channelHex = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`.toUpperCase();
}

/** Linear blend from `from` toward `to` by weight `w` (0..1), rounding per channel exactly like the canvas. */
export function mix(from: string, to: string, w: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]);
}

/** WCAG 2.x relative luminance (0..1). */
export function relativeLuminance(hex: string): number {
  const linear = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text color for content placed on a solid tone fill (buttons, avatars, step numbers). */
export function pickInk(tone: string): string {
  const canvasPick = relativeLuminance(tone) > 0.36 ? INK : WHITE;
  if (contrastRatio(canvasPick, tone) >= AA) return canvasPick;
  return contrastRatio(INK, tone) > contrastRatio(WHITE, tone) ? INK : WHITE;
}

/** Moves `color` toward `target` in 4% steps until it reaches `ratio` against `surface` (or hits the target). */
export function ensureContrast(color: string, surface: string, target: string, ratio = AA): string {
  let current = color;
  for (let step = 1; step <= 25 && contrastRatio(current, surface) < ratio; step += 1) {
    current = mix(color, target, step * 0.04);
  }
  return current;
}

/** Tone color for text and icons on the page (light or dark). */
export function eventTextColor(tone: string, dark: boolean): string {
  const L = relativeLuminance(tone);
  const canvas = dark ? mix(tone, WHITE, 0.45) : L > 0.18 ? mix(tone, BLACK, 0.42) : normalizeHex(tone) ?? BLACK;
  return dark ? ensureContrast(canvas, SURFACE_DARK, WHITE) : ensureContrast(canvas, SURFACE_LIGHT, BLACK);
}

// ---------------------------------------------------------------- HSL helpers for derived ambient colors

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl([r8, g8, b8]: Rgb): Hsl {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Secondary (30%) and accent (10%) ambient colors. Only ever used as diffuse light behind the glass,
 * never for text. Warm rotation for the secondary, a far rotation for the accent, like the canvas triads
 * (Navidad #C81E3A -> #E9A93B / #1E6B4E).
 */
export function ambientColors(tone: string): { secondary: string; accent: string } {
  const base = rgbToHsl(hexToRgb(tone));
  const s = base.s < 0.08 ? 0.12 : base.s;
  // Warm tones (reds, oranges, yellows) get a golden secondary and a deep complementary accent;
  // cool tones (greens, blues, purples) get a warm complementary secondary and a light analogous accent.
  const warm = base.h >= 300 || base.h < 90;
  const secondary = rgbToHex(hslToRgb({ h: base.h + (warm ? 45 : 180), s: clamp(s, 0.6, 0.85), l: 0.6 }));
  const accent = warm
    ? rgbToHex(hslToRgb({ h: base.h + 165, s: clamp(s, 0.4, 0.6), l: 0.34 }))
    : rgbToHex(hslToRgb({ h: base.h + 28, s: clamp(s, 0.35, 0.55), l: 0.62 }));
  return { secondary, accent };
}

// ---------------------------------------------------------------- CSS custom properties

export type EventVarName =
  | "--ev"
  | "--ev-rgb"
  | "--ev-ink"
  | "--ev-soft"
  | "--ev-text"
  | "--ev-glass"
  | "--ev-ring"
  | "--ev-bar"
  | "--ev2"
  | "--ev3";

export type EventVars = Readonly<Record<EventVarName, string>>;

/** CSS custom properties for one event tone in one color scheme. Invalid tones fall back to DEFAULT_TONE. */
export function eventVars(tone: string, dark: boolean): EventVars {
  const c = normalizeHex(tone) ?? DEFAULT_TONE;
  const rgb = hexToRgb(c).join(",");
  const { secondary, accent } = ambientColors(c);
  return {
    "--ev": c,
    "--ev-rgb": rgb,
    "--ev-ink": pickInk(c),
    "--ev-soft": `rgba(${rgb},${dark ? 0.22 : 0.12})`,
    "--ev-text": eventTextColor(c, dark),
    "--ev-glass": `rgba(${rgb},0.66)`,
    "--ev-ring": `rgba(${rgb},${dark ? 0.32 : 0.22})`,
    // Progress fills: the tone itself on light, the lighter text tone on dark (as in EventoOscuro).
    "--ev-bar": dark ? eventTextColor(c, true) : c,
    "--ev2": secondary,
    "--ev3": accent,
  };
}
