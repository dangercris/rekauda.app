/**
 * Page pipeline for the HTML entries (`/`, `/admin`, `/r/<slug>`): fetch the SPA shell from the assets, set the title
 * and description of THIS tenant, and inline its public config as `<script type="application/json" id="rekauda-config">`
 * so the client has it before any script runs. One pipeline, so link-preview tags, boot JSON and headers cannot drift.
 * A JSON script never executes, so the CSP does not change. Tenant strings are untrusted: titles go through the
 * rewriter's text escaping and the JSON escapes every `<`.
 */
import type { ConfigResponse } from "../shared/api";
import type { RequestContext } from "./context";
import type { CloudEnv } from "./env";
import { buildOgMeta, escapeAttr, metaTags, publicOrigin, withPageHeaders } from "./og";
import { toPublicConfig } from "./public-config";
import { isPublicRow, type CollectionRow } from "./rows";

export const BOOT_SCRIPT_ID = "rekauda-config";

/** JSON that is safe inside a script element: `<` (so no `</script` or `<!--`), `>`, `&` and the JS line separators become \u escapes. */
export function bootJson(config: ConfigResponse): string {
  return JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface PageMeta {
  title: string;
  description: string;
  /** Preview tags built by og.ts from escaped values. They already include the description, so none is added then. */
  headTags?: string;
}

/** Rewrites an HTML shell: replaces title and description, drops stale preview tags, appends tags and the boot JSON. */
export function renderShell(shell: Response, config: ConfigResponse, meta: PageMeta): Response {
  return new HTMLRewriter()
    // Static preview tags of the shell would show up next to the tenant's, so crawlers could see duplicates.
    .on('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]', {
      element(el) {
        el.remove();
      },
    })
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on("head", {
      element(el) {
        const description = `<meta name="description" content="${escapeAttr(meta.description)}">`;
        el.append(`${meta.headTags ?? description}<script type="application/json" id="${BOOT_SCRIPT_ID}">${bootJson(config)}</script>`, { html: true });
      },
    })
    .transform(shell);
}

type ShellEnv = Pick<CloudEnv, "ASSETS" | "TENANCY">;

async function fetchShell(request: Request, env: ShellEnv, url: URL, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(path, url), { method: request.method, headers: { accept: "text/html" } }));
}

const isHtml = (response: Response): boolean => response.ok && (response.headers.get("content-type") ?? "").includes("text/html");

/** The title and description of the home and admin entries, from the tenant's own names. */
function entryMeta(rc: RequestContext, kind: "home" | "admin"): PageMeta {
  const { classShortName, className } = rc.config;
  return kind === "admin"
    ? { title: `Tesorería ${classShortName}`, description: `Panel de tesorería de las recaudaciones de ${className}.` }
    : { title: `Recaudaciones ${classShortName}`, description: `Pagos y comprobantes de las recaudaciones de ${className}.` };
}

/** GET|HEAD `/` and `/admin` (and their .html names): the shell with this tenant's title, description and boot JSON. */
export async function serveShell(request: Request, env: ShellEnv, rc: RequestContext, url: URL, kind: "home" | "admin"): Promise<Response> {
  const path = kind === "admin" ? "/admin" : "/";
  if (request.method !== "GET" && request.method !== "HEAD") return fetchShell(request, env, url, path);
  const shell = await fetchShell(request, env, url, path);
  if (!isHtml(shell)) return shell;
  return withPageHeaders(renderShell(shell, toPublicConfig(rc.config, env.TENANCY), entryMeta(rc, kind)), true, kind === "admin");
}

/**
 * Everything else that is not an API route: the assets answer, and when that answer is the SPA fallback HTML
 * (`/admin/<sub>`, `/r`, an unknown path) it is rewritten like the entries above. Non-HTML responses pass untouched.
 */
export async function serveFallback(request: Request, env: ShellEnv, rc: RequestContext, url: URL): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  if ((request.method !== "GET" && request.method !== "HEAD") || !isHtml(response)) return response;
  const admin = url.pathname.startsWith("/admin/");
  return withPageHeaders(renderShell(response, toPublicConfig(rc.config, env.TENANCY), entryMeta(rc, admin ? "admin" : "home")), true, admin);
}

/** GET /r/<slug>[/...]: the SPA shell, with preview tags when the slug is a public collection of this tenant. */
export async function servePage(request: Request, env: ShellEnv, rc: RequestContext, url: URL, slug: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);

  const shell = await fetchShell(request, env, url, "/");
  if (!isHtml(shell)) return shell;
  const config = toPublicConfig(rc.config, env.TENANCY);

  let row: CollectionRow | null;
  try {
    row = await rc.db.prepare("SELECT * FROM collections WHERE tenant_id = ?1 AND slug = ?2 AND status != 'archivada'").bind(slug).first<CollectionRow>();
  } catch (err) {
    // The preview is an enhancement: serve the plain shell instead of failing the page.
    console.error(JSON.stringify({ level: "error", event: "og_lookup_failed", slug, message: err instanceof Error ? err.message : String(err) }));
    return withPageHeaders(renderShell(shell, config, entryMeta(rc, "home")), true);
  }
  if (!row || !isPublicRow(row)) return withPageHeaders(renderShell(shell, config, entryMeta(rc, "home")), true);

  const meta = buildOgMeta(row, publicOrigin(url), rc.config.classShortName);
  return withPageHeaders(renderShell(shell, config, { title: meta.title, description: meta.description, headTags: metaTags(meta) }), true);
}
