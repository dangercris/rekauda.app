import { GA_MEASUREMENT_ID } from "./config";

const PLACEHOLDER_ID = "G-XXXXXXXXXX";

/** True only when a real Measurement ID is configured. */
export function isAnalyticsEnabled(): boolean {
  return GA_MEASUREMENT_ID !== PLACEHOLDER_ID && /^G-[A-Z0-9]{4,}$/.test(GA_MEASUREMENT_ID);
}
