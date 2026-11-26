import { HttpError } from "../http";

/**
 * Every state-changing request (POST, DELETE...) must come from this very origin (scheme, host and port of the resolved
 * host). SameSite=Strict does not stop a sibling subdomain, which is same-site, so this check is the CSRF defense there.
 */
export function assertSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("origin");
  if (origin !== url.origin) throw new HttpError(403, "forbidden_origin", "Solicitud no permitida.");
}

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
