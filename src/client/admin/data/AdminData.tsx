/**
 * Data shared by every admin screen: collections, the selected collection (persisted), its payments
 * and the payment actions. Mounted only while signed in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AdminCollection } from "../../../shared/api";
import { isString, readJson, writeJson } from "../../lib/storage";
import { useAdminCollections, type AdminCollectionsApi } from "./useAdminCollections";
import { usePaymentActions, type PaymentActionsApi } from "./usePaymentActions";
import { useMovements, type MovementsApi } from "./useMovements";
import { usePayments, type PaymentsApi } from "./usePayments";

export const SELECTED_KEY = "adm.collection";

export interface AdminDataValue {
  collections: AdminCollectionsApi;
  /** Collections a payment view can be scoped to (not archived), open ones first. */
  pickable: AdminCollection[];
  selected: AdminCollection | null;
  select: (id: string) => void;
  payments: PaymentsApi;
  /** Deuna transfers waiting for a payment (drives the Movimientos tab badge). */
  movements: MovementsApi;
  actions: PaymentActionsApi;
  /** Refresh collections (stats) and payments together. */
  refreshAll: () => Promise<void>;
}

const AdminDataContext = createContext<AdminDataValue | null>(null);

/** Open collections first (by deadline), then closed ones; archived are excluded. */
export function pickableCollections(collections: readonly AdminCollection[]): AdminCollection[] {
  const rank = (c: AdminCollection): number => (c.status === "abierta" ? 0 : 1);
  return collections
    .filter((c) => c.status !== "archivada")
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.deadline.localeCompare(b.deadline) || a.title.localeCompare(b.title, "es"));
}

export function resolveSelected(pickable: readonly AdminCollection[], wanted: string | null): AdminCollection | null {
  return pickable.find((c) => c.id === wanted) ?? pickable[0] ?? null;
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const collections = useAdminCollections();
  const [wanted, setWanted] = useState<string | null>(() => readJson(SELECTED_KEY, isString));
  const pickable = useMemo(() => pickableCollections(collections.collections), [collections.collections]);
  const selected = collections.status === "ready" ? resolveSelected(pickable, wanted) : null;
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    if (selectedId && selectedId !== wanted) setWanted(selectedId);
    if (selectedId) writeJson(SELECTED_KEY, selectedId);
  }, [selectedId, wanted]);

  const select = useCallback((id: string) => {
    setWanted(id);
    writeJson(SELECTED_KEY, id);
  }, []);

  const payments = usePayments(selectedId, collections.status === "ready");
  const movements = useMovements();
  const { reload: reloadCollections } = collections;
  const onChanged = useCallback(() => {
    void reloadCollections({ silent: true });
  }, [reloadCollections]);
  const actions = usePaymentActions({ setPayments: payments.setPayments, onChanged });

  const { reload: reloadPayments } = payments;
  const { reload: reloadMovements } = movements;
  const refreshAll = useCallback(async () => {
    await Promise.all([reloadCollections({ silent: true }), reloadPayments(), reloadMovements({ silent: true })]);
  }, [reloadCollections, reloadPayments, reloadMovements]);

  const value = useMemo<AdminDataValue>(
    () => ({ collections, pickable, selected, select, payments, movements, actions, refreshAll }),
    [collections, pickable, selected, select, payments, movements, actions, refreshAll],
  );
  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export function useAdminData(): AdminDataValue {
  const value = useContext(AdminDataContext);
  if (!value) throw new Error("useAdminData must be used inside <AdminDataProvider>");
  return value;
}
