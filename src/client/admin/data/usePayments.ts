import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AdminPayment } from "../../../shared/api";
import { errorMessage, listPayments } from "../../lib/api";
import { useApiErrorGate } from "../session/SessionContext";
import type { LoadStatus } from "./useAdminCollections";

export interface PaymentsApi {
  /** Payments of `collectionId`, newest first (server order). */
  payments: AdminPayment[];
  /** The collection the list belongs to (null while nothing is selected). */
  collectionId: string | null;
  status: LoadStatus;
  error: string | null;
  refreshing: boolean;
  /** When the list was last loaded (for "Actualizado hace 2 min"). */
  loadedAt: Date | null;
  reload: (options?: { silent?: boolean | undefined }) => Promise<void>;
  setPayments: Dispatch<SetStateAction<AdminPayment[]>>;
}

/** Payments scoped to one collection. Changing the collection aborts the previous request. */
export function usePayments(collectionId: string | null, enabled = true): PaymentsApi {
  const gate = useApiErrorGate();
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loadedFor = useRef<string | null | undefined>(undefined);

  const load = useCallback(
    async (id: string | null, silent: boolean) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      if (loadedFor.current !== id) {
        // Another collection: never show the previous collection's rows under the new title.
        setStatus("loading");
        setPayments([]);
      } else if (!silent) {
        setRefreshing(true);
      }
      if (id === null) {
        loadedFor.current = null;
        setListId(null);
        setPayments([]);
        setStatus("ready");
        setRefreshing(false);
        return;
      }
      try {
        const data = await listPayments(id, { signal: current.signal });
        if (current.signal.aborted) return;
        loadedFor.current = id;
        setListId(id);
        setPayments(data.payments);
        setStatus("ready");
        setError(null);
        setLoadedAt(new Date());
      } catch (caught) {
        if (current.signal.aborted || gate(caught)) return;
        setError(errorMessage(caught));
        if (loadedFor.current !== id) setStatus("error");
      } finally {
        if (controller.current === current) setRefreshing(false);
      }
    },
    [gate],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    void load(collectionId, false);
    return () => controller.current?.abort();
  }, [collectionId, enabled, load]);

  const reload = useCallback(
    (options: { silent?: boolean | undefined } = {}) => load(collectionId, options.silent ?? false),
    [collectionId, load],
  );

  return { payments, collectionId: listId, status, error, refreshing, loadedAt, reload, setPayments };
}
