import { tenantNotFound } from "../tenancy/resolver";
import type { LegacyRedirects } from "./legacy-redirects";

/**
 * The apex host (ROOT_DOMAIN and www) in multi mode. It is not a tenant, so it never touches D1 or the app shell:
 * - `/` is a static landing with its own restrictive CSP (a separate document from the app CSP).
 * - Exactly the configured legacy paths answer 302 + no-store, query kept. Matching is exact on the raw pathname:
 *   no trailing slash, case folding, percent-decoding or dot-segment handling, so nothing but the configured string matches.
 * - Everything else, and any method other than GET and HEAD, is the generic 404.
 */
const LANDING_CSP = "default-src 'none'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const LANDING_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rekauda</title>
</head>
<body>
<h1>Rekauda</h1>
<p>Recaudaciones simples para cursos y grupos.</p>
<p>Si recibiste un enlace, ábrelo desde el mensaje que te enviaron.</p>
</body>
</html>
`;

export function serveApex(request: Request, url: URL, redirects: LegacyRedirects): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return tenantNotFound();
  const { pathname } = url;
  if (pathname === "/") {
    return new Response(LANDING_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": LANDING_CSP,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "public, max-age=300",
      },
    });
  }
  const target = Object.hasOwn(redirects, pathname) ? redirects[pathname] : undefined;
  if (target) return new Response(null, { status: 302, headers: { location: target + url.search, "cache-control": "no-store" } });
  return tenantNotFound();
}
