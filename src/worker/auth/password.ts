import type { OkResponse } from "../../shared/api";
import type { RequestContext } from "../context";
import { SELF_HOST_OWNER_ID } from "../data/platform-db";
import { HttpError, clientIp, enforceLimit, json, readJson } from "../http";
import { SESSION_TTL_S, type SessionStore, sessionCookie } from "./sessions";

/** The self-host password provider: one shared secret that maps to the synthetic owner of the seeded tenant. */
export interface PasswordLogin {
  adminPassword: string;
  limiter: RateLimit;
}

/** Constant-time comparison: hash both sides so lengths always match. */
export async function secretsMatch(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Rate limited per tenant and client IP before the password is even read. Never logs the attempt's value. */
export async function passwordLogin(request: Request, rc: RequestContext, login: PasswordLogin, sessions: SessionStore): Promise<Response> {
  await enforceLimit(login.limiter, `login:${rc.tenant.id}:${clientIp(request)}`);
  const body = await readJson(request);
  const password = typeof body["password"] === "string" ? body["password"] : "";
  if (!(await secretsMatch(password, login.adminPassword))) {
    console.log(JSON.stringify({ message: "admin login failed" }));
    throw new HttpError(401, "invalid_password", "Contraseña incorrecta.");
  }
  const { token } = await sessions.create(SELF_HOST_OWNER_ID);
  // Logging in proves the current password, so after a rotation this closes every session opened with the old one.
  await sessions.revokeOthers(SELF_HOST_OWNER_ID, token);
  return json({ ok: true } satisfies OkResponse, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_S) });
}
