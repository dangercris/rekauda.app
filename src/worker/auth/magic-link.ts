import type { OkResponse } from "../../shared/api";
import type { RequestContext } from "../context";
import type { PlatformDb } from "../data/platform-db";
import { HttpError, clientIp, enforceLimit, json, readJson } from "../http";
import { base64Url, sha256Hex } from "../ids";
import type { EmailSender } from "../mail/email-sender";
import { assertAddress } from "../mail/mime";
import { normalizeHost } from "../tenancy/host";
import { SESSION_TTL_S, type SessionStore, sessionCookie } from "./sessions";

/** Single use and short lived. */
export const MAGIC_LINK_TTL_S = 15 * 60;
/** Links issued per address and tenant inside one TTL window. */
export const MAX_LINKS_PER_EMAIL = 3;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Cloud sign-in by emailed link. `defer` runs a task after the answer (ctx.waitUntil): token, row and mail all happen
 * there, so members, non-members and capped addresses do the same work before the 200. `rootDomain` is the platform
 * domain used for the link when the request host has no live tenant_domains row.
 */
export interface MagicLinkDeps {
  sender: EmailSender;
  members: Pick<PlatformDb, "findMemberByEmail" | "findLiveHostname" | "recordLogin">;
  limiter: RateLimit;
  rootDomain: string;
  defer: (work: () => Promise<void>) => void;
}

/** consumed_at value of a link whose mail could not be sent: unusable, and not counted against the cap. */
const SEND_FAILED = "send_failed";

const hashToken = (token: string): Promise<string> => sha256Hex(new TextEncoder().encode(token));

const invalidLink = () => new HttpError(401, "invalid_link", "El enlace no es válido o ya fue usado. Pide uno nuevo.");

function parseEmail(value: unknown): string {
  try {
    if (typeof value === "string") return assertAddress(value.trim().toLowerCase());
  } catch {
    // fall through to the same error
  }
  throw new HttpError(400, "invalid_email", "Escribe un correo válido.");
}

function emailBody(link: string): string {
  return [
    "Hola,",
    "",
    `Usa este enlace para ingresar a la tesorería de tu curso en Rekauda. Es válido por ${MAGIC_LINK_TTL_S / 60} minutos y solo se puede usar una vez:`,
    "",
    link,
    "",
    "Si no lo pediste tú, ignora este mensaje: sin el enlace nadie puede ingresar.",
    "",
  ].join("\n");
}

/** Scheme and host of the link, decided by the CANONICAL host (never the request scheme or port): https, except local development. */
function linkOrigin(host: string, port: string): string {
  const local = host === "localhost" || host.endsWith(".localhost");
  return local ? `http://${host}${port ? `:${port}` : ""}` : `https://${host}`;
}

/**
 * The link points at one of THIS tenant's own hosts: the live tenant_domains row matching the request host, or the
 * platform subdomain `<slug>.<root domain>`. Request-controlled parts (scheme, port, casing, trailing dot) are dropped.
 */
async function canonicalOrigin(rc: RequestContext, deps: MagicLinkDeps, url: URL): Promise<string> {
  const requested = normalizeHost(url.host);
  const live = requested ? await deps.members.findLiveHostname(rc.tenant.id, requested) : null;
  const host = normalizeHost(live ?? `${rc.tenant.slug}.${deps.rootDomain}`);
  if (!host) throw new Error("no canonical host");
  return linkOrigin(host, url.port);
}

async function issueLink(rc: RequestContext, deps: MagicLinkDeps, email: string, url: URL, issuedAt: number): Promise<void> {
  try {
    const origin = await canonicalOrigin(rc, deps, url);
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await hashToken(token);
    await rc.db
      .prepare("INSERT INTO magic_links (tenant_id, token_hash, email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(hash, email, new Date(issuedAt).toISOString(), new Date(issuedAt + MAGIC_LINK_TTL_S * 1000).toISOString())
      .run();
    try {
      await deps.sender.send({ to: email, subject: "Tu enlace de acceso a Rekauda", text: emailBody(`${origin}/admin#acceso=${token}`) });
    } catch {
      // Nobody received this link: retire it and free the slot it took in the cap.
      await rc.db.prepare("UPDATE magic_links SET consumed_at = ?3 WHERE tenant_id = ?1 AND token_hash = ?2").bind(hash, SEND_FAILED).run();
      throw new Error("send failed");
    }
  } catch {
    console.error(JSON.stringify({ message: "magic_link_send_failed" }));
  }
}

/**
 * Always the same 200, whether or not the address is a member or the cap is reached. The inline work (limiter, member
 * lookup, cap count) is identical for everyone; only a member under the cap gets the deferred task that creates the row
 * (SHA-256 of a 256-bit token, this tenant, 15 minutes) and sends the mail. The cap check and the insert are separate
 * statements, so concurrent requests can overshoot it by a few links: the per-IP limiter bounds that. Never logs the address or the token.
 */
export async function requestMagicLink(request: Request, rc: RequestContext, deps: MagicLinkDeps, url: URL, now: () => number): Promise<Response> {
  await enforceLimit(deps.limiter, `ml:${rc.tenant.id}:${clientIp(request)}`);
  const email = parseEmail((await readJson(request))["email"]);
  const member = await deps.members.findMemberByEmail(rc.tenant.id, email);
  const issuedAt = now();
  const recent = await rc.db
    .prepare("SELECT COUNT(*) AS n FROM magic_links WHERE tenant_id = ?1 AND email = ?2 AND created_at > ?3 AND COALESCE(consumed_at, '') != 'send_failed'")
    .bind(email, new Date(issuedAt - MAGIC_LINK_TTL_S * 1000).toISOString())
    .first<{ n: number }>();
  if (member && (recent?.n ?? 0) < MAX_LINKS_PER_EMAIL) deps.defer(() => issueLink(rc, deps, email, url, issuedAt));
  return json({ ok: true } satisfies OkResponse);
}

/**
 * Consumes the link with ONE conditional UPDATE (tenant, hash, unused, unexpired) and requires exactly one changed row,
 * so two simultaneous attempts cannot both win. Every failure is the same 401. Other sessions of the member are left
 * alone: a link proves control of the mailbox, not that older sessions were compromised (only a password rotation revokes).
 */
export async function verifyMagicLink(request: Request, rc: RequestContext, deps: MagicLinkDeps, sessions: SessionStore, now: () => number): Promise<Response> {
  await enforceLimit(deps.limiter, `mlv:${rc.tenant.id}:${clientIp(request)}`);
  const given = (await readJson(request))["token"];
  if (typeof given !== "string" || !TOKEN_PATTERN.test(given)) throw invalidLink();
  const hash = await hashToken(given);
  const at = new Date(now()).toISOString();
  // Housekeeping: this tenant's expired links are useless, so every verification clears them.
  await rc.db.prepare("DELETE FROM magic_links WHERE tenant_id = ?1 AND expires_at <= ?2").bind(at).run();

  const consumed = await rc.db
    .prepare("UPDATE magic_links SET consumed_at = ?2 WHERE tenant_id = ?1 AND token_hash = ?3 AND consumed_at IS NULL AND expires_at > ?2")
    .bind(at, hash)
    .run();
  if (consumed.meta.changes !== 1) throw invalidLink();

  const link = await rc.db.prepare("SELECT email FROM magic_links WHERE tenant_id = ?1 AND token_hash = ?2").bind(hash).first<{ email: string }>();
  const member = link ? await deps.members.findMemberByEmail(rc.tenant.id, link.email) : null;
  if (!member) throw invalidLink();

  const { token } = await sessions.create(member.userId);
  await deps.members.recordLogin(member.userId, at);
  return json({ ok: true } satisfies OkResponse, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_S) });
}
