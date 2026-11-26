import { isGtagActive, sendEvent } from "./gtag";

/**
 * Every custom event and its parameters. No personal data ever: no names, phones, tracking codes,
 * amounts or receipt details. `collection` is the public collection slug.
 */
export interface AnalyticsEvents {
  pay_step_view: { step: 1 | 2 | 3; collection: string };
  deuna_click: { collection: string; kind: "charge_link" | "app" };
  payment_submitted: { collection: string; students: number };
  payment_failed: { collection: string; error_code: string };
  status_lookup: { result: "found" | "not_found" | "error" };
  share_click: { collection: string };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/** Allowlist enforced at runtime: any extra key is dropped before it reaches Google. */
export const EVENT_PARAM_KEYS: { [E in AnalyticsEventName]: readonly (keyof AnalyticsEvents[E] & string)[] } = {
  pay_step_view: ["step", "collection"],
  deuna_click: ["collection", "kind"],
  payment_submitted: ["collection", "students"],
  payment_failed: ["collection", "error_code"],
  status_lookup: ["result"],
  share_click: ["collection"],
};

/** Sends a custom event. A no-op unless the visitor granted consent. */
export function track<E extends AnalyticsEventName>(event: E, params: AnalyticsEvents[E]): void {
  if (!isGtagActive()) return;
  const allowed: readonly string[] = EVENT_PARAM_KEYS[event];
  const clean = Object.fromEntries(Object.entries(params).filter(([key]) => allowed.includes(key)));
  sendEvent(event, clean);
}
