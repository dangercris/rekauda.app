/** Public entry of the analytics module: components import only from here. */
export { isAnalyticsEnabled } from "./enabled";
export { useAnalyticsEnabled } from "./useAnalyticsEnabled";
export { openPreferences, setConsent, useConsent, type ConsentChoice, type ConsentState } from "./consent";
export { track, type AnalyticsEventName, type AnalyticsEvents } from "./events";
export { applyConsent, sendPageView } from "./gtag";
