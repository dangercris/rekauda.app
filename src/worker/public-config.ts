import type { ConfigResponse } from "../shared/api";
import type { Instance } from "../shared/instance";
import type { TenancyMode } from "./env";

/**
 * The public face of a tenant's config: GET /api/config and the boot JSON in the HTML are both built here, field by
 * field, so nothing that is not listed (the label derived for validation messages, anything stored next to the config)
 * can leak. `treasury` is public on purpose: families need it to pay.
 */
export function toPublicConfig(config: Instance, mode: TenancyMode): ConfigResponse {
  const t = config.treasury;
  return {
    className: config.className,
    schoolName: config.schoolName,
    classShortName: config.classShortName,
    classMark: config.classMark,
    banks: [...config.banks],
    treasury: {
      bank: t.bank,
      accountType: t.accountType,
      accountNumber: t.accountNumber,
      holder: t.holder,
      holderId: t.holderId,
      deunaUrl: t.deunaUrl,
      qrUrl: t.qrUrl,
      helpUrl: t.helpUrl,
    },
    earliestTransferDate: config.earliestTransferDate,
    defaultTone: config.defaultTone,
    analytics: { gaMeasurementId: config.analytics.gaMeasurementId },
    auth: { mode: mode === "single" ? "password" : "magic_link" },
  };
}
