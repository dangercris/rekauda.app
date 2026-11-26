/**
 * Resolution of per-school values. Pure: nothing is read or validated when this module loads, so the Worker can
 * resolve a different config for every tenant. The bundled `rekauda.config.ts` is read elsewhere (the single-mode
 * ConfigStore on the server, `instance-bundled.ts` for the client until it gets a ConfigProvider).
 */
import type { InstanceConfig } from "./instance-config";
import { monthYearEs, validateInstanceConfig } from "./instance-validation";

/** A validated config plus the values derived from it. */
export interface Instance extends InstanceConfig {
  /** "noviembre de 2026": used in the "date is too old" messages. */
  readonly earliestTransferLabel: string;
}

/** Validates `config` (fail-fast, naming the field) and derives the display values. */
export function resolveInstance(config: InstanceConfig, source?: string): Instance {
  const valid = validateInstanceConfig(config, source);
  return { ...valid, earliestTransferLabel: monthYearEs(valid.earliestTransferDate) };
}
