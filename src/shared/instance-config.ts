import type { TreasuryAccount } from "./api";

/**
 * Everything that differs from one school to the next. Edit `rekauda.config.ts` (a local, untracked copy of
 * `rekauda.config.example.ts`); the rest of the code reads the resolved values from `src/shared/instance.ts`.
 */
export interface InstanceConfig {
  /** e.g. "Mi Colegio". Used in the footer disclaimer and the link-preview card. */
  schoolName: string;
  /** e.g. "1.º de Básica A". Long form, used in copy and meta descriptions. */
  className: string;
  /** e.g. "1.º Básica A". Short form, used in HTML/document titles and link previews. */
  classShortName: string;
  /** e.g. "1A". One to three characters, shown in the brand avatar. */
  classMark: string;
  /** Where families send the money. Public on purpose: it is served by GET /api/config. */
  treasury: TreasuryAccount;
  /** Banks offered in the payment form. */
  banks: readonly string[];
  /** ISO date (YYYY-MM-DD): transfers dated before it are rejected. */
  earliestTransferDate: string;
  /** `#RRGGBB` tone for new collections. */
  defaultTone: string;
  analytics: {
    /** Google Analytics 4 Measurement ID ("G-XXXXXXXXXX" shape), or null to disable analytics entirely. */
    gaMeasurementId: string | null;
  };
}

/** Identity helper that gives `rekauda.config.ts` full type checking and autocompletion. */
export function defineInstanceConfig(config: InstanceConfig): InstanceConfig {
  return config;
}
