import { CLASS_SHORT_NAME } from "../shared/instance";
import { OG_HEIGHT, OG_WIDTH, ogVersion } from "./og-card";
import { isPublicRow, type CollectionRow } from "./rows";

/** Link previews (WhatsApp, Telegram, Facebook...) for `/r/<slug>`: the SPA shell with the collection's meta tags injected. */

export const SITE_SUFFIX = CLASS_SHORT_NAME;
const MAX_DESCRIPTION = 160;

export type OgMeta = {
  /** Document title and og:title. */
  title: string;
  description: string;
  url: string;
  /** Absolute URL of the generated preview card (/api/og/<slug>.jpg?v=<version>). */
  image: string;
  imageAlt: string;
};

type OgSource = Pick<CollectionRow, "slug" | "title" | "description" | "updated_at">;

/** Trims whitespace and cuts at ~max chars on a word boundary, adding an ellipsis. */
export function truncateDescription(raw: string, max = MAX_DESCRIPTION): string {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const slice = value.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** Previews need absolute https URLs; plain http is only kept for local development hosts. */
export function publicOrigin(url: URL): string {
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return local ? url.origin : `https://${url.host}`;
}

export function buildOgMeta(collection: OgSource, origin: string): OgMeta {
  return {
    title: `${collection.title} · ${SITE_SUFFIX}`,
    description: truncateDescription(collection.description),
    url: `${origin}/r/${collection.slug}`,
    image: `${origin}/api/og/${collection.slug}.jpg?v=${ogVersion(collection)}`,
    imageAlt: `${collection.title}: datos de pago y fecha límite`,
  };
}

/** Escapes a value for use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The tags to inject, as [attribute name, attribute value, content] triples. Values are escaped by `metaTags`. */
export function metaEntries(meta: OgMeta): Array<{ attr: "name" | "property"; key: string; content: string }> {
  const entries: Array<{ attr: "name" | "property"; key: string; content: string }> = [
    { attr: "name", key: "description", content: meta.description },
    { attr: "property", key: "og:type", content: "website" },
    { attr: "property", key: "og:title", content: meta.title },
    { attr: "property", key: "og:description", content: meta.description },
    { attr: "property", key: "og:url", content: meta.url },
    { attr: "property", key: "og:locale", content: "es_EC" },
    { attr: "property", key: "og:image", content: meta.image },
    { attr: "property", key: "og:image:secure_url", content: meta.image },
    { attr: "property", key: "og:image:type", content: "image/jpeg" },
    { attr: "property", key: "og:image:width", content: String(OG_WIDTH) },
    { attr: "property", key: "og:image:height", content: String(OG_HEIGHT) },
    { attr: "property", key: "og:image:alt", content: meta.imageAlt },
    { attr: "name", key: "twitter:card", content: "summary_large_image" },
    { attr: "name", key: "twitter:image", content: meta.image },
  ];
  return entries;
}

export function metaTags(meta: OgMeta): string {
  return metaEntries(meta)
    .map((e) => `<meta ${e.attr}="${e.key}" content="${escapeAttr(e.content)}">`)
    .join("");
}

/** Same CSP as public/_headers; the Worker repeats it so the HTML never depends on how the asset was served. */
const PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-cache",
};

/**
 * Adds the page security headers. When the body was rewritten the validators of the original asset no
 * longer describe it, so ETag / Last-Modified are dropped (otherwise a stale 304 could hide the OG tags).
 */
export function withPageHeaders(response: Response, rewritten = false): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(PAGE_HEADERS)) out.headers.set(name, value);
  if (rewritten) {
    out.headers.delete("ETag");
    out.headers.delete("Last-Modified");
  }
  return out;
}

/** GET /r/<slug>[/...]: the SPA shell, with preview tags when the slug is a public collection. */
export async function servePage(request: Request, env: Env, url: URL, slug: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);

  const shell = await env.ASSETS.fetch(new Request(new URL("/", url), { method: request.method, headers: { accept: "text/html" } }));
  if (!shell.ok || !(shell.headers.get("content-type") ?? "").includes("text/html")) return shell;

  let row: CollectionRow | null;
  try {
    row = await env.DB.prepare("SELECT * FROM collections WHERE slug = ? AND status != 'archivada'").bind(slug).first<CollectionRow>();
  } catch (err) {
    // The preview is an enhancement: serve the plain shell instead of failing the page.
    console.error(JSON.stringify({ level: "error", event: "og_lookup_failed", slug, message: err instanceof Error ? err.message : String(err) }));
    return withPageHeaders(shell);
  }
  if (!row || !isPublicRow(row)) return withPageHeaders(shell);

  const meta = buildOgMeta(row, publicOrigin(url));
  const tags = metaTags(meta);
  const rewritten = new HTMLRewriter()
    // Drop any static preview tags from the shell so crawlers never see duplicates.
    .on('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]', {
      element(el) {
        el.remove();
      },
    })
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on("head", {
      element(el) {
        el.append(tags, { html: true });
      },
    })
    .transform(shell);
  return withPageHeaders(rewritten, true);
}
