import { CustomFont, cache, render } from "@cf-wasm/og/workerd";
import geistBold from "./fonts/Geist-Bold.ttf";
import geistMedium from "./fonts/Geist-Medium.ttf";
import { BASE_HEADERS, fail } from "./http";
import { buildOgCard, OG_HEIGHT, OG_WIDTH, ogVersion, rgba, type OgCard } from "./og-card";
import { isPublicRow, type CollectionRow } from "./rows";

/**
 * GET /api/og/<slug>.jpg: the link-preview image (WhatsApp, Telegram, Facebook...) drawn from the collection itself:
 * event tone, title, price, deadline and cover. Rendered with Satori + resvg (WASM) to PNG, re-encoded to JPEG
 * with the Images binding (WhatsApp skips heavy previews; a photo cover makes the PNG several hundred KB),
 * and stored in R2 once per collection version.
 */

type Style = Record<string, string | number>;

/** Satori's element shape (plain objects, so the Worker needs no React). */
export type VNode = { type: string; props: { style?: Style; children?: string | VNode | VNode[]; [prop: string]: unknown } };

const FONTS = [
  new CustomFont("Geist", geistMedium, { weight: 500 }),
  new CustomFont("Geist", geistBold, { weight: 700 }),
];

/** Covers the renderer can decode. WEBP covers fall back to the tone artwork. */
const COVER_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png" };

function el(type: string, style: Style, children?: string | VNode | Array<VNode | null>, extra: Record<string, unknown> = {}): VNode {
  const kids = Array.isArray(children) ? children.filter((c): c is VNode => c !== null) : children;
  return { type, props: { style, ...extra, ...(kids === undefined ? {} : { children: kids }) } };
}

function glow(color: string, size: number, left: number, top: number, alpha: number): VNode {
  return el("div", {
    position: "absolute",
    left,
    top,
    width: size,
    height: size,
    borderRadius: size,
    backgroundImage: `radial-gradient(circle, ${rgba(color, alpha)} 0%, ${rgba(color, 0)} 70%)`,
  });
}

export function cardTree(card: OgCard, coverDataUrl: string | null): VNode {
  const { colors } = card;
  const ink = colors.ink;
  const onDark = ink === "#FFFFFF";
  const glass = onDark ? "rgba(255, 255, 255, 0.14)" : "rgba(14, 17, 23, 0.08)";
  const glassBorder = onDark ? "rgba(255, 255, 255, 0.28)" : "rgba(14, 17, 23, 0.16)";
  const muted = rgba(ink, 0.74);
  const textWidth = coverDataUrl ? 620 : 1000;
  const titleSize = card.title.length > 48 ? 58 : card.title.length > 28 ? 68 : 80;

  const pill = (text: string): VNode =>
    el(
      "div",
      {
        display: "flex",
        alignItems: "center",
        padding: "12px 26px",
        borderRadius: 999,
        backgroundColor: glass,
        border: `1.5px solid ${glassBorder}`,
        fontSize: 26,
        fontWeight: 500,
        color: ink,
      },
      text,
    );

  const cover = coverDataUrl
    ? el("div", {
        position: "absolute",
        right: 56,
        top: 56,
        width: 452,
        height: 518,
        display: "flex",
        borderRadius: 40,
        overflow: "hidden",
        border: `2px solid ${glassBorder}`,
        boxShadow: "0 30px 60px rgba(7, 8, 11, 0.35)",
      }, [el("img", { width: 452, height: 518, objectFit: "cover" }, undefined, { src: coverDataUrl, width: 452, height: 518 })])
    : null;

  return el(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: "flex",
      position: "relative",
      overflow: "hidden",
      fontFamily: "Geist",
      color: ink,
      backgroundColor: colors.tone,
      backgroundImage: `linear-gradient(140deg, ${colors.tone} 0%, ${colors.deep} 100%)`,
    },
    [
      glow(colors.secondary, 760, 620, -360, 0.55),
      glow(colors.accent, 820, -380, 240, 0.6),
      cover,
      el(
        "div",
        {
          position: "absolute",
          left: 72,
          top: 64,
          bottom: 64,
          width: textWidth,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        },
        [
          el("div", { display: "flex", fontSize: 24, fontWeight: 500, letterSpacing: 3, textTransform: "uppercase", color: muted }, card.school),
          el("div", { display: "flex", flexDirection: "column" }, [
            card.eyebrow ? el("div", { display: "flex", fontSize: 32, fontWeight: 500, color: muted, marginBottom: 14 }, card.eyebrow) : null,
            el(
              "div",
              { display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2.5, lineClamp: 3, maxHeight: titleSize * 1.04 * 3 + 4 },
              card.title,
            ),
          ]),
          el("div", { display: "flex", alignItems: "flex-end", justifyContent: "space-between" }, [
            el("div", { display: "flex", alignItems: "flex-end" }, [
              card.pricePrefix ? el("div", { display: "flex", fontSize: 28, fontWeight: 500, color: muted, marginRight: 14, marginBottom: 16 }, card.pricePrefix) : null,
              el("div", { display: "flex", fontSize: 104, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }, card.priceWhole),
              el("div", { display: "flex", fontSize: 50, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1, marginBottom: 8, color: muted }, card.priceCents),
              card.priceSuffix ? el("div", { display: "flex", fontSize: 28, fontWeight: 500, color: muted, marginLeft: 18, marginBottom: 14 }, card.priceSuffix) : null,
            ]),
            coverDataUrl ? null : pill(card.badge),
          ]),
        ],
      ),
      // With a cover the badge sits on the image so the price row keeps its room.
      coverDataUrl
        ? el("div", { position: "absolute", right: 84, top: 84, display: "flex" }, [
            el(
              "div",
              {
                display: "flex",
                padding: "12px 24px",
                borderRadius: 999,
                backgroundColor: "rgba(7, 8, 11, 0.62)",
                border: "1.5px solid rgba(255, 255, 255, 0.24)",
                fontSize: 24,
                fontWeight: 500,
                color: "#FFFFFF",
              },
              card.badge,
            ),
          ])
        : null,
    ],
  );
}

async function coverDataUrl(env: Env, key: string | null): Promise<string | null> {
  const ext = key?.split(".").pop() ?? "";
  const type = COVER_TYPES[ext];
  if (!key || !type) return null;
  const object = await env.RECEIPTS.get(key);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

const JPEG_QUALITY = 85;

/** PNG -> JPEG through the Images binding. The PNG is served as is if the binding is unavailable or fails. */
async function encode(env: Env, png: Uint8Array): Promise<{ body: ArrayBuffer | Uint8Array; type: string }> {
  try {
    const result = await env.IMAGES.input(new Blob([png]).stream()).output({ format: "image/jpeg", quality: JPEG_QUALITY });
    return { body: await new Response(result.image()).arrayBuffer(), type: result.contentType() };
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "og_jpeg_failed", message: err instanceof Error ? err.message : String(err) }));
    return { body: png, type: "image/png" };
  }
}

/** Rendered cards are stored once per collection version (the Cache API is a no-op on workers.dev). */
export const OG_PREFIX = "og/";

export function ogKey(slug: string, version: string): string {
  return `${OG_PREFIX}${slug}/${version}.jpg`;
}

/** Deletes the stored cards of older versions of this collection. */
async function pruneOldCards(env: Env, slug: string, keep: string): Promise<void> {
  const { objects } = await env.RECEIPTS.list({ prefix: `${OG_PREFIX}${slug}/` });
  const stale = objects.map((o) => o.key).filter((key) => key !== keep);
  if (stale.length) await env.RECEIPTS.delete(stale);
}

/**
 * GET|HEAD /api/og/<slug>.jpg[?v=...]
 * Always answers with the card for the collection as it is now. The URL version only decides caching:
 * the current `v` is immutable, anything else (old link, no `v`) is cached briefly.
 */
export async function serveOgImage(request: Request, env: Env, ctx: ExecutionContext, url: URL, slug: string): Promise<Response> {
  cache.setExecutionContext(ctx);
  const row = await env.DB.prepare("SELECT * FROM collections WHERE slug = ?").bind(slug).first<CollectionRow>();
  if (!row || !isPublicRow(row)) return fail(404, "not_found", "Imagen no encontrada.");

  const version = ogVersion(row);
  const key = ogKey(slug, version);
  const headers = (type: string): Record<string, string> => ({
    ...BASE_HEADERS,
    "Content-Type": type,
    "Cache-Control": url.searchParams.get("v") === version ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Robots-Tag": "noindex",
  });
  const respond = (body: BodyInit, type: string): Response => new Response(request.method === "HEAD" ? null : body, { headers: headers(type) });

  const stored = await env.RECEIPTS.get(key);
  if (stored) return respond(stored.body, "image/jpeg");

  let cover: string | null = null;
  try {
    cover = await coverDataUrl(env, row.cover_key);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "og_cover_failed", slug, message: err instanceof Error ? err.message : String(err) }));
  }

  const { image } = await render(cardTree(buildOgCard(row), cover), { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS }).asPng();
  const encoded = await encode(env, image);
  // Only JPEGs are stored: a PNG fallback means the Images binding failed, so the next request tries again.
  if (encoded.type === "image/jpeg") {
    ctx.waitUntil(
      env.RECEIPTS.put(key, encoded.body, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { slug, version } })
        .then(() => pruneOldCards(env, slug, key))
        .catch((err: unknown) => console.error(JSON.stringify({ level: "error", event: "og_store_failed", slug, message: err instanceof Error ? err.message : String(err) }))),
    );
  }
  console.log(JSON.stringify({ message: "og image rendered", slug, version, type: encoded.type, bytes: encoded.body.byteLength, cover: cover !== null }));
  return respond(encoded.body, encoded.type);
}
