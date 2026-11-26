/**
 * Google Analytics 4 Measurement ID, read from `rekauda.config.ts` (analytics.gaMeasurementId).
 * Kill switch: null in the config (mapped to the placeholder "G-XXXXXXXXXX") and analytics is fully disabled
 * (no banner, no footer button, nothing loads).
 */
import { GA_MEASUREMENT_ID as INSTANCE_GA_ID } from "../../../../shared/instance";

export const GA_MEASUREMENT_ID: string = INSTANCE_GA_ID ?? "G-XXXXXXXXXX";
