/**
 * gtag.js bootstrap. The CSP forbids inline scripts, so dataLayer, the gtag function and the config
 * calls live here and only the Google library itself is loaded through a <script src>.
 * Nothing in this module runs until consent is granted.
 */
import { isAnalyticsEnabled } from "./enabled";

const SCRIPT_URL = "https://www.googletagmanager.com/gtag/js";

type ConsentChoice = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let configured = false;
let active = false;
/** The id gtag was last granted for, so a later "denied" switches off that same id. */
let activeId: string | null = null;

function gtag(...args: unknown[]): void {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtagShim() {
      // gtag.js expects the `arguments` object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  window.gtag(...args);
}

function appendScript(id: string): void {
  if (document.querySelector(`script[src^="${SCRIPT_URL}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `${SCRIPT_URL}?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

function setDisabled(id: string, disabled: boolean): void {
  // Documented GA opt-out switch: stops all measurement for this ID on the page.
  Reflect.set(window, `ga-disable-${id}`, disabled);
}

function grant(id: string): void {
  setDisabled(id, false);
  if (!configured) {
    // Consent Mode v2: everything denied by default, only analytics storage is granted after "Aceptar".
    gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date());
    gtag("config", id, { send_page_view: false });
    configured = true;
  } else {
    gtag("consent", "update", { analytics_storage: "granted" });
  }
  appendScript(id);
  active = true;
  activeId = id;
}

/** Best-effort removal of the GA cookies on the host and its parent domains. */
export function deleteGaCookies(): void {
  try {
    const names = document.cookie
      .split(";")
      .map((part) => part.split("=")[0]?.trim() ?? "")
      .filter((name) => name === "_ga" || name.startsWith("_ga_") || name === "_gid" || name.startsWith("_gat"));
    if (names.length === 0) return;
    const host = window.location.hostname;
    const labels = host.split(".");
    const domains = new Set<string | null>([null, host, `.${host}`]);
    for (let i = 1; i < labels.length - 1; i += 1) domains.add(`.${labels.slice(i).join(".")}`);
    for (const name of names) {
      for (const domain of domains) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
      }
    }
  } catch {
    // Cookies unavailable: nothing to delete.
  }
}

function revoke(id: string): void {
  active = false;
  setDisabled(id, true);
  if (configured) gtag("consent", "update", { analytics_storage: "denied" });
  deleteGaCookies();
}

/**
 * Applies a consent choice for the tenant's Measurement ID: granted loads and configures gtag once, denied stops
 * everything. A null or invalid id (analytics off for this tenant) does nothing at all.
 */
export function applyConsent(choice: ConsentChoice | null, measurementId: string | null): void {
  if (!isAnalyticsEnabled(measurementId) || choice === null) return;
  if (choice === "granted") grant(measurementId);
  else revoke(measurementId);
}

/** True while consent is granted and gtag is configured. */
export function isGtagActive(): boolean {
  return active && activeId !== null;
}

export function sendEvent(name: string, params: Record<string, unknown>): void {
  if (!isGtagActive()) return;
  gtag("event", name, params);
}

export function sendPageView(path: string, title: string): void {
  sendEvent("page_view", { page_path: path, page_title: title, page_location: `${window.location.origin}${path}` });
}

/** Test helper: forgets module state (script tags and globals are cleaned by the tests). */
export function resetGtagForTests(): void {
  configured = false;
  active = false;
  activeId = null;
}
