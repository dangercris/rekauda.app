import { useSyncExternalStore } from "react";
import { readJson, writeJson } from "../../../lib/storage";
import { applyConsent } from "./gtag";

export const CONSENT_KEY = "rec-analytics-consent";
/** Bump when the analytics policy changes so everyone is asked again. */
export const CONSENT_VERSION = 1;

export type ConsentChoice = "granted" | "denied";

interface StoredConsent {
  choice: ConsentChoice;
  version: number;
}

export interface ConsentState {
  /** null until the visitor decides (or after a version bump). */
  choice: ConsentChoice | null;
  /** The visitor reopened the banner from the footer. */
  preferencesOpen: boolean;
}

function isStoredConsent(value: unknown): value is StoredConsent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record["choice"] === "granted" || record["choice"] === "denied") && typeof record["version"] === "number";
}

/** Stored choice, or null when missing, unreadable (storage throws) or recorded under another policy version. */
export function readConsent(): ConsentChoice | null {
  const stored = readJson(CONSENT_KEY, isStoredConsent);
  return stored && stored.version === CONSENT_VERSION ? stored.choice : null;
}

let state: ConsentState | null = null;
const listeners = new Set<() => void>();

function current(): ConsentState {
  state = state ?? { choice: readConsent(), preferencesOpen: false };
  return state;
}

function update(next: ConsentState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getConsentState(): ConsentState {
  return current();
}

/** Stores the choice (memory wins when storage fails), applies it to gtag and closes the banner. */
export function setConsent(choice: ConsentChoice): void {
  writeJson(CONSENT_KEY, { choice, version: CONSENT_VERSION } satisfies StoredConsent);
  update({ choice, preferencesOpen: false });
  applyConsent(choice);
}

/** Reopens the banner (footer "Preferencias de cookies"). */
export function openPreferences(): void {
  update({ ...current(), preferencesOpen: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribe, getConsentState, getConsentState);
}

/** Test helper: drops the in-memory state so the next read hits storage again. */
export function resetConsentForTests(): void {
  state = null;
  for (const listener of listeners) listener();
}
