import type { OkResponse } from "../shared/api";
import { SESSION_COOKIE, SESSION_TTL_S } from "./constants";
import { HttpError, clientIp, enforceLimit, json, readJson } from "./http";
import { base64Url } from "./ids";

export function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function hasValidSession(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const [expRaw, signature] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000) || !signature) return false;
  const expected = await hmac(env.SESSION_SECRET, `adm:${exp}`);
  return secretsMatch(signature, expected);
}

/** Every state-changing admin request (POST, DELETE...) must come from this same origin. */
export function assertSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("origin");
  if (origin !== url.origin) throw new HttpError(403, "forbidden_origin", "Solicitud no permitida.");
}

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
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

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64Url(new Uint8Array(signature));
}

export async function login(request: Request, env: Env): Promise<Response> {
  await enforceLimit(env.LOGIN_LIMITER, `login:${clientIp(request)}`);
  const body = await readJson(request);
  const password = typeof body.password === "string" ? body.password : "";
  const ok = await secretsMatch(password, env.ADMIN_PASSWORD);
  if (!ok) {
    console.log(JSON.stringify({ message: "admin login failed" }));
    throw new HttpError(401, "invalid_password", "Contraseña incorrecta.");
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const token = `${exp}.${await hmac(env.SESSION_SECRET, `adm:${exp}`)}`;
  return json({ ok: true } satisfies OkResponse, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_S) });
}

export function logout(): Response {
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
