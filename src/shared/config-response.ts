/**
 * Parser for the public config as the client receives it (GET /api/config and the boot JSON). The instance fields go
 * through the same validation the Worker applies to a tenant's config, so one set of rules guards both ends. Only
 * known fields are copied and messages name fields, never values.
 */
import type { ConfigResponse } from "./api";
import { parseInstanceConfig, validateInstanceConfig } from "./instance-validation";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseConfigResponse(raw: unknown, source: string): ConfigResponse {
  const fail = (field: string, expected: string): never => {
    throw new Error(`Invalid ${source}: ${field} must be ${expected}.`);
  };
  const instance = parseInstanceConfig(raw, source);
  // parseInstanceConfig already proved both objects exist.
  const record = raw as Record<string, unknown>;
  const treasury = record["treasury"] as Record<string, unknown>;
  const qrUrl = treasury["qrUrl"] ?? null;
  if (qrUrl !== null && typeof qrUrl !== "string") fail("treasury.qrUrl", "a string or null");

  const auth = record["auth"];
  const mode = isRecord(auth) ? auth["mode"] : undefined;
  if (mode !== "password" && mode !== "magic_link") fail("auth.mode", "password or magic_link");

  const checked = validateInstanceConfig({ ...instance, treasury: { ...instance.treasury, qrUrl: qrUrl as string | null } }, source);
  return {
    className: checked.className,
    schoolName: checked.schoolName,
    classShortName: checked.classShortName,
    classMark: checked.classMark,
    banks: [...checked.banks],
    treasury: { ...checked.treasury },
    earliestTransferDate: checked.earliestTransferDate,
    defaultTone: checked.defaultTone,
    analytics: { gaMeasurementId: checked.analytics.gaMeasurementId },
    auth: { mode: mode as "password" | "magic_link" },
  };
}
