const PLACEHOLDER_ID = "G-XXXXXXXXXX";

/** True only for a real Measurement ID from the tenant config. null, the placeholder and malformed ids all mean "off". */
export function isAnalyticsEnabled(measurementId: string | null): measurementId is string {
  return measurementId !== null && measurementId !== PLACEHOLDER_ID && /^G-[A-Z0-9]{4,20}$/.test(measurementId);
}
