/**
 * Payment collections for one school class (costumes, trips, gifts...).
 * Each collection has its own options and prices; parents pay by bank transfer and attach the receipt.
 *
 * Public API:  GET /api/config, GET /api/collections[/:slug[/board]], POST /api/payments, GET /api/lookup/:code,
 *              GET /api/covers/<id>/<hash>.<ext>, GET /api/og/<slug>.jpg (link-preview card)
 * Admin API:   /api/admin/* (password login -> signed HttpOnly cookie)
 * Email:       email() handler for Deuna notifications (Email Routing), see src/worker/email/
 * Pages:       GET /r/<slug> (SPA shell + link-preview tags); everything else is served as static assets.
 * Contract:    src/shared/api.ts
 */
import { adminRoute } from "./admin";
import { handleEmail } from "./email/handler";
import { collectionBoard, collectionDetail, listCollections } from "./collections";
import { serveCover } from "./covers";
import { HttpError, fail } from "./http";
import { servePage } from "./og";
import { serveOgImage } from "./og-image";
import { createPayment, lookup, publicConfig } from "./payments";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      return await route(request, env, ctx, url);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message);
      console.error(
        JSON.stringify({
          message: "unhandled error",
          path: url.pathname,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return fail(500, "internal", "Ocurrió un error inesperado. Intenta de nuevo en unos minutos.");
    }
  },

  /** Email Routing: Deuna "Recibiste $X" notifications (src/worker/email/handler.ts). Always forwards first. */
  async email(message, env): Promise<void> {
    await handleEmail(message, env);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  const pageSlug = /^\/r\/([a-z0-9-]{1,48})(?:\/.*)?$/.exec(pathname)?.[1];
  if (pageSlug) return servePage(request, env, url, pageSlug);
  if (pathname.startsWith("/r/") || pathname === "/r") return env.ASSETS.fetch(request);

  if (pathname === "/api/payments" && method === "POST") return createPayment(request, env);
  if (pathname === "/api/config" && method === "GET") return publicConfig();
  if (pathname === "/api/collections" && method === "GET") return listCollections(env);

  const collectionMatch = /^\/api\/collections\/([a-z0-9-]{1,48})(\/board)?$/.exec(pathname);
  const slug = collectionMatch?.[1];
  if (slug && method === "GET") return collectionMatch[2] ? collectionBoard(env, slug) : collectionDetail(env, slug);

  const lookupCode = /^\/api\/lookup\/([A-Za-z0-9-]{1,12})$/.exec(pathname)?.[1];
  if (lookupCode && method === "GET") return lookup(request, env, lookupCode);

  const coverPath = pathname.startsWith("/api/covers/") ? pathname.slice("/api/covers/".length) : null;
  if (coverPath !== null && method === "GET") return serveCover(env, coverPath);

  const ogSlug = /^\/api\/og\/([a-z0-9-]{1,48})\.(?:jpg|png)$/.exec(pathname)?.[1];
  if (ogSlug && (method === "GET" || method === "HEAD")) return serveOgImage(request, env, ctx, url, ogSlug);

  if (pathname.startsWith("/api/admin/")) return adminRoute(request, env, url);

  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  return fail(404, "not_found", "Ruta no encontrada.");
}
