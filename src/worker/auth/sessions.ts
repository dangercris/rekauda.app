import type { AdminRole } from "../../shared/api";
import { ADMIN_ROLES } from "../../shared/api";
import type { TenantDb } from "../data/tenant-db";
import { base64Url, sha256Hex } from "../ids";

/** `__Host-` makes browsers accept the cookie only with Secure, Path=/ and no Domain: it can never be shared with a sibling subdomain. */
export const SESSION_COOKIE = "__Host-rk_session";
/** Absolute lifetime: using a session never extends it. */
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Strict";

export interface AdminIdentity {
  userId: string;
  role: AdminRole;
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; ${ATTRIBUTES}; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return sessionCookie("", 0);
}

function readToken(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(`${SESSION_COOKIE}=`)) {
      const value = cookie.slice(SESSION_COOKIE.length + 1);
      return TOKEN_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

const hashToken = (token: string): Promise<string> => sha256Hex(new TextEncoder().encode(token));

/**
 * Server-side sessions of ONE tenant. The cookie holds a random 256-bit token; only its SHA-256 hash is stored, so a
 * database read does not yield usable cookies. Every statement goes through the tenant-bound TenantDb: a token that
 * belongs to another tenant simply is not found. `now` is injected so expiry is testable without the wall clock.
 */
export class SessionStore {
  constructor(
    private readonly db: TenantDb,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts a session for a member of this tenant (the foreign key rejects anyone else). Also drops this tenant's expired rows. */
  async create(userId: string): Promise<{ token: string }> {
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + SESSION_TTL_S * 1000).toISOString();
    await this.db.prepare("DELETE FROM sessions WHERE tenant_id = ?1 AND expires_at <= ?2").bind(createdAt).run();
    await this.db
      .prepare("INSERT INTO sessions (tenant_id, token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(await hashToken(token), userId, createdAt, expiresAt)
      .run();
    return { token };
  }

  /** The member and role behind the request's cookie in THIS tenant, or null (missing, malformed, unknown, expired, no longer a member). */
  async resolve(request: Request): Promise<AdminIdentity | null> {
    const token = readToken(request);
    if (!token) return null;
    const row = await this.db
      .prepare(
        `SELECT s.user_id, m.role FROM sessions s JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = ?1
          WHERE s.tenant_id = ?1 AND s.token_hash = ?2 AND s.expires_at > ?3`,
      )
      .bind(await hashToken(token), new Date(this.now()).toISOString())
      .first<{ user_id: string; role: string }>();
    const role = ADMIN_ROLES.find((r) => r === row?.role);
    return row && role ? { userId: row.user_id, role } : null;
  }

  /** Drops every other session of this user in this tenant, keeping the one whose token is given. */
  async revokeOthers(userId: string, keepToken: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM sessions WHERE tenant_id = ?1 AND user_id = ?2 AND token_hash != ?3")
      .bind(userId, await hashToken(keepToken))
      .run();
  }

  async revoke(request: Request): Promise<void> {
    const token = readToken(request);
    if (token) await this.db.prepare("DELETE FROM sessions WHERE tenant_id = ?1 AND token_hash = ?2").bind(await hashToken(token)).run();
  }
}
