import type { RequestContext } from "./context";
import { BASE_HEADERS, fail } from "./http";
import { assetKey } from "./storage/keys";

const TYPE_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const NOT_FOUND = "Imagen no encontrada.";

/**
 * GET|HEAD /api/assets/deuna-qr.<ext>?v=<version>: the tenant's Deuna QR, read from its own R2 prefix.
 * It is served only when this tenant's config links exactly this route (D1ConfigStore builds that link from the
 * tenant's `qr_key`), so a tenant without a QR, or a request for another extension, is a 404 that never touches R2.
 * The version only decides caching: the current one is immutable, anything else is cached briefly.
 */
export async function serveDeunaQr(request: Request, { storage, config }: RequestContext, ext: string): Promise<Response> {
  const linked = config.treasury.qrUrl;
  const type = TYPE_BY_EXT[ext];
  if (!type || linked?.split("?")[0] !== `/api/assets/deuna-qr.${ext}`) return fail(404, "not_found", NOT_FOUND);

  const object = await storage.get(storage.keyFor(assetKey(`deuna-qr.${ext}`)));
  if (!object) return fail(404, "not_found", NOT_FOUND);

  const current = new URL(linked, "https://qr.invalid").searchParams.get("v");
  const requested = new URL(request.url).searchParams.get("v");
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      ...BASE_HEADERS,
      "X-Robots-Tag": "noindex",
      "Content-Type": type,
      "Cache-Control": current && requested === current ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
