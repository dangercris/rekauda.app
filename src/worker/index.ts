/**
 * Payment collections for one school class (costumes, trips, gifts...).
 * Each collection has its own options and prices; parents pay by bank transfer and attach the receipt.
 *
 * Public API:  GET /api/config (the tenant's public config, also inlined as boot JSON in the HTML), GET /api/assets/deuna-qr.<ext>, GET /api/collections[/:slug[/board]], POST /api/payments, GET /api/lookup/:code,
 *              GET /api/covers/<id>/<hash>.<ext>, GET /api/og/<slug>.jpg (link-preview card)
 * Admin API:   /api/admin/* (D1 sessions in a host-only cookie; self-host signs in with ADMIN_PASSWORD, Cloud with magic links)
 * Email:       email() handler for Deuna notifications (Email Routing), see src/worker/email/
 * Tenancy:     this file is the composition root. It resolves the tenant (Host header in multi mode, the seeded tenant in
 *              single mode) and hands handlers a RequestContext; handlers never see env.DB or env.RECEIPTS.
 * Pages:       GET /, /admin, /r/<slug> (SPA shell + tenant title, boot JSON and link-preview tags: src/worker/boot.ts);
 *              everything else is served as static assets.
 * Contract:    src/shared/api.ts
 */
import { serveDeunaQr } from "./assets";
import { adminRoute } from "./admin";
import type { MagicLinkDeps } from "./auth/magic-link";
import type { PasswordLogin } from "./auth/password";
import { serveFallback, servePage, serveShell } from "./boot";
import { buildContext, type RequestContext } from "./context";
import { PlatformDb } from "./data/platform-db";
import { handleEmail, type InboundRoute } from "./email/handler";
import { resolveInboundTenant } from "./email/inbound";
import { collectionBoard, collectionDetail, listCollections } from "./collections";
import { serveCover } from "./covers";
import type { CloudEnv, MultiEnv, SingleEnv } from "./env";
import { HttpError, enforceLimit, fail, json } from "./http";
import { CloudflareEmailSender } from "./mail/email-sender";
import { EmailRoutingForwarder, SendEmailNotifier } from "./mail/mail-forwarder";
import { serveOgImage } from "./og-image";
import { createPayment, lookup } from "./payments";
import { toPublicConfig } from "./public-config";
import { R2MailArchive } from "./storage/mail-archive";
import { D1ConfigStore, type ConfigStore } from "./tenancy/config-store";
import { tenancyState } from "./tenancy/runtime";
import { HostTenantResolver, SingleTenantResolver, tenantNotFound, type TenantResolver } from "./tenancy/resolver";
import type { Tenant } from "./tenancy/tenant";

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
   * Inbound Deuna mail (src/worker/email/handler.ts). Multi: ONE catch-all on INBOUND_DOMAIN delivers here and the tenant
   * is the owner of the recipient's token; an unknown recipient is rejected before the body is read. Single: Email Routing
   * forwards to FORWARD_TO and the seeded tenant is resolved lazily, after the forward.
   */
  async email(message, env): Promise<void> {
    const route =
      env.TENANCY === "multi"
        ? await multiInboundRoute(message, env)
        : env.TENANCY === "single"
          ? singleInboundRoute(env)
          : reject(message, "inbound_mail_not_configured", "error");
    if (route) await handleEmail(message, route);
  },

  /** Daily cron (triggers.crons in the Cloud config): deletes archived mail past the 30-day retention. The scheduled time is the clock. */
  async scheduled(controller, env): Promise<void> {
    if (!env.MAIL_ARCHIVE) return;
    try {
      const deleted = await new R2MailArchive(env.MAIL_ARCHIVE, () => new Date(controller.scheduledTime), () => crypto.randomUUID()).purgeExpired();
      console.log(JSON.stringify({ message: "mail_archive_purged", deleted }));
    } catch (e) {
      console.error(JSON.stringify({ message: "mail_archive_purge_failed", error: e instanceof Error ? e.message : String(e) }));
    }
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

/** The self-host password provider exists only in single mode. Cloud has no password: admin there needs a magic-link session. */
function passwordLoginFor(env: CloudEnv): PasswordLogin | null {
  return env.TENANCY === "single" && env.ADMIN_PASSWORD ? { adminPassword: env.ADMIN_PASSWORD, limiter: env.LOGIN_LIMITER } : null;
}

/**
 * Magic links exist only in multi mode. The sender address is `no-reply@<ROOT_DOMAIN>` (its domain must be onboarded for
 * send_email, see the sandbox checklist). A misconfigured address disables the feature (404) instead of breaking all of admin.
 */
function magicLinkFor(env: CloudEnv, ec: ExecutionContext): MagicLinkDeps | null {
  if (env.TENANCY !== "multi") return null;
  try {
    return {
      sender: cloudSenderFor(env),
      members: new PlatformDb(env.DB),
      limiter: env.LOGIN_LIMITER,
      rootDomain: env.ROOT_DOMAIN,
      defer: (work) => ec.waitUntil(work()),
    };
  } catch {
    console.error(JSON.stringify({ message: "magic_link_not_configured" }));
    return null;
  }
}

function reject(message: ForwardableEmailMessage, event: string, level: "log" | "error", fields: Record<string, string> = {}): null {
  message.setReject("Recipient not accepted.");
  console[level](JSON.stringify({ message: event, ...fields }));
  return null;
}

/** Cloud sender of platform mail: `no-reply@<ROOT_DOMAIN>` through the send_email binding. Throws when it is not configured. */
function cloudSenderFor(env: MultiEnv): CloudflareEmailSender {
  if (!env.SEND_EMAIL) throw new Error("SEND_EMAIL binding missing");
  return new CloudflareEmailSender(env.SEND_EMAIL, `no-reply@${env.ROOT_DOMAIN}`);
}

/**
 * Multi: everything that can refuse the message happens here, BEFORE its body is read, and fails closed with setReject
 * (a bounce is better than a Deuna payment notice that silently vanished). Logs never carry the address.
 */
async function multiInboundRoute(message: ForwardableEmailMessage, env: MultiEnv): Promise<InboundRoute | null> {
  const platform = new PlatformDb(env.DB);
  let tenant: Tenant | null;
  try {
    tenant = await resolveInboundTenant(message.to, env.INBOUND_DOMAIN, platform);
  } catch {
    return reject(message, "inbound_mail_lookup_failed", "error");
  }
  if (!tenant) return reject(message, "inbound_mail_rejected", "log", { reason: "unknown_recipient" });
  let forwarder: SendEmailNotifier;
  try {
    forwarder = new SendEmailNotifier(cloudSenderFor(env), platform, tenant.id, env.LOOKUP_LIMITER);
  } catch {
    return reject(message, "inbound_mail_not_configured", "error");
  }
  // Nobody to notify means the treasurer would never hear of this mail: bounce it now, while rejecting is still possible.
  try {
    if ((await platform.listNotificationRecipients(tenant.id)).length === 0) return reject(message, "inbound_mail_no_recipients", "error");
  } catch {
    return reject(message, "inbound_mail_lookup_failed", "error");
  }
  const found = tenant;
  return {
    forwarder,
    archive: env.MAIL_ARCHIVE ? new R2MailArchive(env.MAIL_ARCHIVE, () => new Date(), () => crypto.randomUUID()) : null,
    verifyBeforeDeliver: true,
    resolveTenant: async () => found,
    loadContext: (t) => loadTenantContext(env, t),
  };
}

function singleInboundRoute(env: SingleEnv): InboundRoute {
  return {
    forwarder: new EmailRoutingForwarder(env.FORWARD_TO),
    archive: env.MAIL_ARCHIVE ? new R2MailArchive(env.MAIL_ARCHIVE, () => new Date(), () => crypto.randomUUID()) : null,
    verifyBeforeDeliver: false,
    resolveTenant: () => resolverFor(env, null).resolve(""),
    loadContext: (t) => loadTenantContext(env, t),
  };
}

async function loadTenantContext(env: CloudEnv, tenant: Tenant): Promise<RequestContext | null> {
  const config = await configStoreFor(env).load(tenant);
  return config ? buildContext(tenant, { db: env.DB, files: env.RECEIPTS }, config) : null;
}

/** Multi: the tenant's validated `config_json` (cached per isolate). Single: the bundled config. */
function configStoreFor(env: CloudEnv): ConfigStore {
  return env.TENANCY === "multi" ? new D1ConfigStore(new PlatformDb(env.DB), tenancyState.configCache, tenancyState.configLastGood) : tenancyState.bundled;
}

async function route(request: Request, env: CloudEnv, ec: ExecutionContext, url: URL): Promise<Response> {
  const tenant = await resolverFor(env, request).resolve(url.host);
  if (!tenant) return tenantNotFound();
  // A tenant without a valid config is not served at all: showing defaults would put someone else's account details on its pages.
  const config = await configStoreFor(env).load(tenant);
  if (!config) return fail(503, "not_ready", "Esta página aún no está disponible.");
  const rc = buildContext(tenant, { db: env.DB, files: env.RECEIPTS }, config);

  const { pathname } = url;
  const method = request.method;

  if (pathname === "/" || pathname === "/index.html") return serveShell(request, env, rc, url, "home");
  if (pathname === "/admin" || pathname === "/admin.html") return serveShell(request, env, rc, url, "admin");

  const pageSlug = /^\/r\/([a-z0-9-]{1,48})(?:\/.*)?$/.exec(pathname)?.[1];
  if (pageSlug) return servePage(request, env, rc, url, pageSlug);

  if (pathname === "/api/payments" && method === "POST") return createPayment(request, rc, env);
  if (pathname === "/api/config" && method === "GET") return json(toPublicConfig(rc.config, env.TENANCY), 200, { "Cache-Control": "public, max-age=60" });
  if (pathname === "/api/collections" && method === "GET") return listCollections(rc);

  const collectionMatch = /^\/api\/collections\/([a-z0-9-]{1,48})(\/board)?$/.exec(pathname);
  const slug = collectionMatch?.[1];
  if (slug && method === "GET") return collectionMatch[2] ? collectionBoard(rc, slug) : collectionDetail(rc, slug);

  const lookupCode = /^\/api\/lookup\/([A-Za-z0-9-]{1,12})$/.exec(pathname)?.[1];
  if (lookupCode && method === "GET") return lookup(request, rc, env, lookupCode);

  const qrExt = /^\/api\/assets\/deuna-qr\.(png|jpg|webp)$/.exec(pathname)?.[1];
  if (qrExt && (method === "GET" || method === "HEAD")) return serveDeunaQr(request, rc, qrExt);

  const coverPath = pathname.startsWith("/api/covers/") ? pathname.slice("/api/covers/".length) : null;
  if (coverPath !== null && method === "GET") return serveCover(rc, coverPath);

  const ogSlug = /^\/api\/og\/([a-z0-9-]{1,48})\.(?:jpg|png)$/.exec(pathname)?.[1];
  if (ogSlug && (method === "GET" || method === "HEAD")) return serveOgImage(request, rc, env, ec, url, ogSlug);

  if (pathname.startsWith("/api/admin/")) return adminRoute(request, rc, passwordLoginFor(env), url, Date.now, magicLinkFor(env, ec));

  // Static files pass through; any HTML that comes back (SPA fallback for /admin/<sub>, /r, /foo) still gets this tenant's boot JSON.
  if (!pathname.startsWith("/api/")) return serveFallback(request, env, rc, url);
  return fail(404, "not_found", "Ruta no encontrada.");
}
