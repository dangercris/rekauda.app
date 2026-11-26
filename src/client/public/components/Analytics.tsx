import { useEffect } from "react";
import { useRoute } from "../../lib/router";
import { useInstanceConfig } from "../../lib/config/useInstance";
import { applyConsent, sendPageView, useAnalyticsEnabled, useConsent } from "../lib/analytics";
import { ConsentBanner } from "./ConsentBanner";

/**
 * Public app only. Restores a stored choice, sends page_view on load and on every route or tab change
 * (granted only), and renders the consent banner. Mounted by the public App, never by the admin.
 */
export function Analytics() {
  const route = useRoute();
  const { choice } = useConsent();
  const { gaMeasurementId } = useInstanceConfig().analytics;
  const enabled = useAnalyticsEnabled();
  const path = route.path + (route.hash ? `#${route.hash}` : "");

  useEffect(() => {
    if (enabled) applyConsent(choice, gaMeasurementId);
  }, [enabled, choice, gaMeasurementId]);

  useEffect(() => {
    if (!enabled || choice !== "granted") return undefined;
    // Short delay: the collection page rewrites the hash and the title right after navigating.
    const timer = setTimeout(() => sendPageView(path, document.title), 50);
    return () => clearTimeout(timer);
  }, [enabled, choice, path]);

  return <ConsentBanner />;
}
