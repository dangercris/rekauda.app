import type { IconName } from "../../../ui";

export type TabKey = "pagar" | "estado" | "avance";

export const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: IconName }> = [
  { key: "pagar", label: "Pagar", icon: "wallet" },
  { key: "estado", label: "Mi estado", icon: "search" },
  { key: "avance", label: "Avance", icon: "users" },
];

const isTabKey = (value: string): value is TabKey => value === "pagar" || value === "estado" || value === "avance";

/**
 * Tab from the URL hash. Closed collections hide Pagar; without a valid hash, open collections start on
 * Pagar and closed ones on Mi estado when this phone has saved codes, otherwise on Avance.
 */
export function resolveTab(hash: string, open: boolean, hasSavedCodes: boolean): TabKey {
  if (isTabKey(hash) && (hash !== "pagar" || open)) return hash;
  if (open) return "pagar";
  return hasSavedCodes ? "estado" : "avance";
}

export function availableTabs(open: boolean): ReadonlyArray<{ key: TabKey; label: string; icon: IconName }> {
  return open ? TABS : TABS.filter((t) => t.key !== "pagar");
}
