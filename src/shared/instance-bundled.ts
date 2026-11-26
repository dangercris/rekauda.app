/**
 * The bundled `rekauda.config.ts` as module-level constants. CLIENT ONLY, and only until the ConfigProvider slice
 * replaces it: the Worker never imports this file (an architecture test enforces it), because in multi mode
 * the config is per tenant. Vitest aliases `rekauda.config` to `rekauda.config.example.ts`.
 */
import config from "../../rekauda.config";
import { resolveInstance } from "./instance";

const instance = resolveInstance(config);

export const SCHOOL_NAME = instance.schoolName;
export const CLASS_NAME = instance.className;
export const CLASS_SHORT_NAME = instance.classShortName;
export const CLASS_MARK = instance.classMark;
export const TREASURY = instance.treasury;
export const BANKS = instance.banks;
export const EARLIEST_TRANSFER = instance.earliestTransferDate;
export const EARLIEST_TRANSFER_LABEL = instance.earliestTransferLabel;
export const DEFAULT_TONE = instance.defaultTone;
export const GA_MEASUREMENT_ID: string | null = instance.analytics.gaMeasurementId;
