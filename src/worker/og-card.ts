import { ambientColors, mix, normalizeHex, pickInk, WHITE } from "../shared/tone";
import { parseOptions } from "./collections";
import type { Instance } from "../shared/instance";
import type { CollectionRow } from "./rows";

/**
 * Data for the link-preview card (1200x630 image served at /api/og/<slug>.jpg).
 * Pure: no rendering, no I/O, so it is unit-tested without the WASM renderer.
 */

/** Bump when the card design changes so crawlers (WhatsApp caches hard) fetch a new image URL. */
export const OG_RENDER_VERSION = "1";
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export type OgCardSource = Pick<CollectionRow, "slug" | "title" | "eyebrow" | "options_json" | "deadline" | "status" | "tone" | "cover_key" | "updated_at">;

export type OgCard = {
  school: string;
  eyebrow: string | null;
  title: string;
  /** Whole part with currency sign, e.g. "$14". */
  priceWhole: string;
  /** Decimal part with separator, e.g. ",00" (drawn smaller, like the app). */
  priceCents: string;
  /** "por estudiante" or "desde" style qualifier. */
  pricePrefix: string | null;
  priceSuffix: string | null;
  /** "Hasta el 2 de diciembre" or "Recaudación cerrada". */
  badge: string;
  closed: boolean;
  colors: {
    tone: string;
    deep: string;
    ink: string;
    secondary: string;
    accent: string;
  };
};

/** "$1.234" + ",50" (Ecuador: dot thousands, comma decimals). */
export function splitMoney(cents: number): { whole: string; cents: string } {
  const safe = Math.max(0, Math.round(cents));
  const whole = Math.floor(safe / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return { whole: `$${whole}`, cents: `,${String(safe % 100).padStart(2, "0")}` };
}

/** "2026-12-02" -> "Hasta el 2 de diciembre". Invalid dates yield null. */
export function deadlineLabel(deadline: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return null;
  return `Hasta el ${Number(m[3])} de ${month}`;
}

/** Cache-busting version for the image URL: renderer version + last collection change. */
export function ogVersion(row: Pick<CollectionRow, "updated_at">): string {
  const t = Date.parse(row.updated_at);
  return `${OG_RENDER_VERSION}${Number.isFinite(t) ? t.toString(36) : "0"}`;
}

export function buildOgCard(row: OgCardSource, config: Pick<Instance, "schoolName" | "className" | "defaultTone">): OgCard {
  const options = parseOptions(row.options_json);
  const prices = options.map((o) => o.cents).filter((c) => c > 0);
  const min = prices.length ? Math.min(...prices) : 0;
  const varied = prices.some((c) => c !== min);
  const money = splitMoney(min);

  const tone = normalizeHex(row.tone) ?? config.defaultTone;
  const { secondary, accent } = ambientColors(tone);
  const closed = row.status !== "abierta";

  return {
    school: `${config.schoolName} · ${config.className}`,
    eyebrow: row.eyebrow?.trim() || null,
    title: row.title.trim(),
    priceWhole: money.whole,
    priceCents: money.cents,
    pricePrefix: varied ? "Desde" : null,
    priceSuffix: varied ? null : "por estudiante",
    badge: closed ? "Recaudación cerrada" : (deadlineLabel(row.deadline) ?? "Recaudación abierta"),
    closed,
    colors: {
      tone,
      deep: mix(tone, "#07080B", 0.55),
      ink: pickInk(tone) === WHITE ? "#FFFFFF" : "#0E1117",
      secondary,
      accent,
    },
  };
}

/** `rgba()` for a #RRGGBB color. */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt((normalizeHex(hex) ?? "#000000").slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
