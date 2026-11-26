import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminBankMovement } from "../../../shared/api";
import { errorMessage, listMovements } from "../../lib/api";
import { useApiErrorGate } from "../session/SessionContext";
import type { LoadStatus } from "./useAdminCollections";

export interface MovementsApi {
  /** Deuna transfers that still need a payment, newest first. */
  movements: AdminBankMovement[];
  status: LoadStatus;
  error: string | null;
  refreshing: boolean;
  reload: (options?: { silent?: boolean | undefined }) => Promise<void>;
}

export function useMovements(): MovementsApi {
  const gate = useApiErrorGate();
  const [movements, setMovements] = useState<AdminBankMovement[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const reload = useCallback(
    async (options: { silent?: boolean | undefined } = {}) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      if (!hasData.current && !options.silent) setStatus("loading");
      else setRefreshing(true);
      try {
        const data = await listMovements("unmatched", { signal: current.signal });
        if (current.signal.aborted) return;
        hasData.current = true;
        setMovements(data.movements);
        setStatus("ready");
        setError(null);
      } catch (caught) {
        if (current.signal.aborted || gate(caught)) return;
        setError(errorMessage(caught));
        if (!hasData.current) setStatus("error");
      } finally {
        if (controller.current === current) setRefreshing(false);
      }
    },
    [gate],
  );

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);

  return { movements, status, error, refreshing, reload };
}
