import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminCollection, CollectionStatus } from "../../../shared/api";
import { errorMessage, listAdminCollections, updateCollection } from "../../lib/api";
import { useApiErrorGate } from "../session/SessionContext";

export type LoadStatus = "loading" | "ready" | "error";

export interface AdminCollectionsApi {
  collections: AdminCollection[];
  status: LoadStatus;
  error: string | null;
  /** A background refresh is running (data stays visible). */
  refreshing: boolean;
  reload: (options?: { silent?: boolean | undefined }) => Promise<void>;
  /** Insert or replace one collection after a mutation response. */
  upsert: (collection: AdminCollection) => void;
  /** Optimistic status change (close, reopen, archive, restore) with rollback. Resolves false on failure. */
  setStatus: (id: string, status: CollectionStatus) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export function useAdminCollections(): AdminCollectionsApi {
  const gate = useApiErrorGate();
  const [collections, setCollections] = useState<AdminCollection[]>([]);
  const [status, setStatusState] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const reload = useCallback(
    async (options: { silent?: boolean | undefined } = {}) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      if (!hasData.current && !options.silent) setStatusState("loading");
      else setRefreshing(true);
      try {
        const data = await listAdminCollections({ signal: current.signal });
        if (current.signal.aborted) return;
        hasData.current = true;
        setCollections(data.collections);
        setStatusState("ready");
        setError(null);
      } catch (caught) {
        if (current.signal.aborted || gate(caught)) return;
        setError(errorMessage(caught));
        if (!hasData.current) setStatusState("error");
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

  const upsert = useCallback((collection: AdminCollection) => {
    setCollections((list) => {
      const index = list.findIndex((c) => c.id === collection.id);
      if (index < 0) return [collection, ...list];
      const next = list.slice();
      next[index] = collection;
      return next;
    });
  }, []);

  const setStatus = useCallback<AdminCollectionsApi["setStatus"]>(
    async (id, next) => {
      let previous: CollectionStatus | null = null;
      setCollections((list) =>
        list.map((c) => {
          if (c.id !== id) return c;
          previous = c.status;
          return { ...c, status: next };
        }),
      );
      try {
        const res = await updateCollection(id, { status: next });
        upsert(res.collection);
        return { ok: true };
      } catch (caught) {
        const restore = previous;
        if (restore !== null) setCollections((list) => list.map((c) => (c.id === id ? { ...c, status: restore } : c)));
        if (gate(caught)) return { ok: false, message: "" };
        return { ok: false, message: errorMessage(caught) };
      }
    },
    [gate, upsert],
  );

  return { collections, status, error, refreshing, reload, upsert, setStatus };
}
