/**
 * Payment collections for one school class (costumes, trips, gifts...).
 * Each collection has its own options and prices; parents pay by bank transfer and attach the receipt.
 *
 * Public API:  GET /api/config, GET /api/collections[/:slug[/board]], POST /api/payments, GET /api/lookup/:code,
 *              GET /api/covers/<id>/<hash>.<ext>, GET /api/og/<slug>.jpg (link-preview card)
 * Admin API:   /api/admin/* (self-host: password login -> signed HttpOnly cookie; Cloud: disabled until D1 sessions)
 * Email:       email() handler for Deuna notifications (Email Routing), see src/worker/email/
 * Tenancy:     this file is the composition root. It resolves the tenant (Host header in multi mode, the seeded tenant in
 *              single mode) and hands handlers a RequestContext; handlers never see env.DB or env.RECEIPTS.
 * Pages:       GET /r/<slug> (SPA shell + link-preview tags); everything else is served as static assets.
 * Contract:    src/shared/api.ts
 */
import { adminRoute } from "./admin";
import type { AdminAuthConfig } from "./auth";
import { buildContext } from "./context";
import { PlatformDb } from "./data/platform-db";
import { handleEmail } from "./email/handler";
import { collectionBoard, collectionDetail, listCollections } from "./collections";
import { serveCover } from "./covers";
import type { CloudEnv } from "./env";
import { HttpError, enforceLimit, fail } from "./http";
import { servePage } from "./og";
import { serveOgImage } from "./og-image";
import { createPayment, lookup, publicConfig } from "./payments";
import { tenancyState } from "./tenancy/runtime";
import { HostTenantResolver, SingleTenantResolver, tenantNotFound, type TenantResolver } from "./tenancy/resolver";

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

  /**
   * Email Routing: Deuna "Recibiste $X" notifications (src/worker/email/handler.ts). Self-host only for now: Cloud has no
   * per-tenant inbound routing yet, so multi mode rejects every message without reading, storing or forwarding it.
   */
  async email(message, env): Promise<void> {
    if (env.TENANCY !== "single") {
      message.setReject("Recipient not accepted.");
      console.log(JSON.stringify({ message: "inbound_mail_rejected", reason: "inbound_routing_not_available" }));
      return;
    }
    // The tenant is resolved lazily, after the forward, so a database problem never stops the mail reaching the treasurer.
    await handleEmail(message, env, async () => {
      const tenant = await resolverFor(env, null).resolve("");
      return tenant ? buildContext(tenant, { db: env.DB, files: env.RECEIPTS }) : null;
    });
  },
} satisfies ExportedHandler<CloudEnv>;

/**
 * Multi: Host header -> tenant, behind a bounded cache. Every uncached lookup is a D1 read, so it is rate limited per
 * client IP on LOOKUP_LIMITER (own key, `host-miss:<ip>`): hosts that do not even parse are refused earlier by the
 * resolver. A request without cf-connecting-ip (never the case behind Cloudflare, nor under wrangler dev) is refused
 * with 429 instead of sharing one bucket. Residual risk: many source IPs can still force uncached reads, capped by the 100-entry miss cache and 15 s TTL.
 * Single: every host -> the seeded self-host tenant. Anything else is a misconfiguration and fails closed.
 */
function resolverFor(env: CloudEnv, request: Request | null): TenantResolver {
  if (env.TENANCY === "multi") {
    const ip = request?.headers.get("cf-connecting-ip") ?? null;
    return new HostTenantResolver(new PlatformDb(env.DB), env.ROOT_DOMAIN, tenancyState.hostCache, () => {
      if (!ip) throw new HttpError(429, "rate_limited", "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.");
      return enforceLimit(env.LOOKUP_LIMITER, `host-miss:${ip}`);
    });
  }
  if (env.TENANCY === "single") {
    tenancyState.single ??= new SingleTenantResolver(new PlatformDb(env.DB));
    return tenancyState.single;
  }
  throw new Error("TENANCY must be multi or single");
}

/** Legacy shared-password admin exists only in single mode: its cookie is not tenant-bound, so Cloud must never use it. */
function adminAuth(env: CloudEnv): AdminAuthConfig | null {
  if (env.TENANCY !== "single" || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return null;
  return { adminPassword: env.ADMIN_PASSWORD, sessionSecret: env.SESSION_SECRET, loginLimiter: env.LOGIN_LIMITER };
}

/** Routes that read the bundled instance config (src/shared/instance.ts) instead of per-tenant data. */
function usesBundledConfig(method: string, pathname: string): boolean {
  return (
    pathname === "/api/config" ||
    (pathname === "/api/payments" && method === "POST") ||
    pathname.startsWith("/api/og/") ||
    pathname === "/r" ||
    pathname.startsWith("/r/")
  );
}

async function route(request: Request, env: CloudEnv, ec: ExecutionContext, url: URL): Promise<Response> {
  const tenant = await resolverFor(env, request).resolve(url.host);
  if (!tenant) return tenantNotFound();
  const rc = buildContext(tenant, { db: env.DB, files: env.RECEIPTS });

  const { pathname } = url;
  const method = request.method;

  // Until tenant config is served from the database, these routes would show the bundled build-time instance
  // (account number, banks, school name) to every tenant, so Cloud refuses them.
  if (env.TENANCY === "multi" && usesBundledConfig(method, pathname)) return fail(503, "not_ready", "Esta función aún no está disponible.");

  const pageSlug = /^\/r\/([a-z0-9-]{1,48})(?:\/.*)?$/.exec(pathname)?.[1];
  if (pageSlug) return servePage(request, env, rc, url, pageSlug);
  if (pathname.startsWith("/r/") || pathname === "/r") return env.ASSETS.fetch(request);

  if (pathname === "/api/payments" && method === "POST") return createPayment(request, rc, env);
  if (pathname === "/api/config" && method === "GET") return publicConfig();
  if (pathname === "/api/collections" && method === "GET") return listCollections(rc);

  const collectionMatch = /^\/api\/collections\/([a-z0-9-]{1,48})(\/board)?$/.exec(pathname);
  const slug = collectionMatch?.[1];
  if (slug && method === "GET") return collectionMatch[2] ? collectionBoard(rc, slug) : collectionDetail(rc, slug);

  const lookupCode = /^\/api\/lookup\/([A-Za-z0-9-]{1,12})$/.exec(pathname)?.[1];
  if (lookupCode && method === "GET") return lookup(request, rc, env, lookupCode);

  const coverPath = pathname.startsWith("/api/covers/") ? pathname.slice("/api/covers/".length) : null;
  if (coverPath !== null && method === "GET") return serveCover(rc, coverPath);

  const ogSlug = /^\/api\/og\/([a-z0-9-]{1,48})\.(?:jpg|png)$/.exec(pathname)?.[1];
  if (ogSlug && (method === "GET" || method === "HEAD")) return serveOgImage(request, rc, env, ec, url, ogSlug);

  if (pathname.startsWith("/api/admin/")) return adminRoute(request, rc, adminAuth(env), url);

  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  return fail(404, "not_found", "Ruta no encontrada.");
}
