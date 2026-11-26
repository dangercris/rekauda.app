import { useInstanceConfig } from "../../../lib/config/useInstance";
import { isAnalyticsEnabled } from "./enabled";

/** Whether the current tenant has analytics on (a real Measurement ID in its config). */
export function useAnalyticsEnabled(): boolean {
  return isAnalyticsEnabled(useInstanceConfig().analytics.gaMeasurementId);
}
