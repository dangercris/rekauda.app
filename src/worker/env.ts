/**
 * Worker bindings split by tenancy mode, picked at the composition root from vars.TENANCY.
 * - multi (Cloud): tenants come from the Host header, so the root and inbound domains, the mail archive and
 *   the send_email binding are required.
 * - single (self-host): one tenant, config bundled, so those four are optional and mail is forwarded with Email Routing.
 * The global `Env` (worker-configuration.d.ts) is still the pilot shape until the handlers move to these types.
 */

export interface BaseEnv {
  DB: D1Database;
  /** Receipts, covers and og cards, always under the tenant prefix. */
  RECEIPTS: R2Bucket;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  SUBMIT_LIMITER: RateLimit;
  LOGIN_LIMITER: RateLimit;
  LOOKUP_LIMITER: RateLimit;
}

export type TenancyMode = "single" | "multi";

export interface MultiEnv extends BaseEnv {
  TENANCY: "multi";
  ROOT_DOMAIN: string;
  INBOUND_DOMAIN: string;
  MAIL_ARCHIVE: R2Bucket;
  SEND_EMAIL: SendEmail;
}

export interface SingleEnv extends BaseEnv {
  TENANCY: "single";
  ADMIN_PASSWORD: string;
  FORWARD_TO: string;
  /** Signs the legacy admin cookie: required for the single-mode admin login until D1 sessions replace it. */
  SESSION_SECRET?: string;
  ROOT_DOMAIN?: string;
  INBOUND_DOMAIN?: string;
  MAIL_ARCHIVE?: R2Bucket;
  SEND_EMAIL?: SendEmail;
}

export type CloudEnv = MultiEnv | SingleEnv;
