import { MAX_JSON_BYTES } from "./constants";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...BASE_HEADERS, ...extra },
  });
}

export function fail(status: number, error: string, message: string): Response {
  return json({ error, message }, status);
}

export async function enforceLimit(limiter: RateLimit, key: string): Promise<void> {
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "rate_limited", "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.");
}

export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    throw new HttpError(415, "bad_content_type", "Formato de envío no válido.");
  }
  const raw = await request.text();
  if (raw.length > maxBytes) throw new HttpError(413, "too_large", "Solicitud demasiado grande.");
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_json", "Solicitud no válida.");
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Reads a multipart body after checking the declared length, so oversized uploads are refused before parsing. */
export async function readMultipart(request: Request, maxBytes: number, tooLargeMessage: string): Promise<FormData> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!declaredLength) throw new HttpError(411, "length_required", "No se pudo leer el envío. Vuelve a intentarlo.");
  if (declaredLength > maxBytes) throw new HttpError(413, "too_large", tooLargeMessage);
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    throw new HttpError(415, "bad_content_type", "Formato de envío no válido.");
  }
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, "bad_form", "No se pudo leer el envío. Vuelve a intentarlo.");
  }
}
