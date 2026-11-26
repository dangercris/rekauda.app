/**
 * The single place the app reads per-school values from. `rekauda.config.ts` (local, untracked) is validated
 * here when the module loads, so a bad value fails fast with a clear message instead of misbehaving at runtime.
 * Vitest aliases `rekauda.config` to `rekauda.config.example.ts`, so tests never depend on the local file.
 */
import config from "../../rekauda.config";
import { monthYearEs, validateInstanceConfig } from "./instance-validation";

const instance = validateInstanceConfig(config);

export const SCHOOL_NAME = instance.schoolName;
export const CLASS_NAME = instance.className;
export const CLASS_SHORT_NAME = instance.classShortName;
export const CLASS_MARK = instance.classMark;
export const TREASURY = instance.treasury;
export const BANKS = instance.banks;
export const EARLIEST_TRANSFER = instance.earliestTransferDate;
/** "noviembre de 2026": used in the "date is too old" messages. */
export const EARLIEST_TRANSFER_LABEL = monthYearEs(instance.earliestTransferDate);
export const DEFAULT_TONE = instance.defaultTone;
export const GA_MEASUREMENT_ID: string | null = instance.analytics.gaMeasurementId;
