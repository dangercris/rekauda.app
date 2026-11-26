/** Data hooks for the public app. Every request is aborted when its component unmounts. */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BoardResponse, CollectionDetail, CollectionsResponse, ConfigResponse } from "../../../shared/api";
import { getBoard, getCollection, getConfig, listCollections } from "../../lib/publicApi";
import { BANKS } from "../../../shared/instance-bundled";
import { FALLBACK_CLASS_NAME, FALLBACK_SCHOOL_NAME } from "../lib/identity";
import { useResource, type Resource } from "./useResource";

export interface ConfigValue {
  config: ConfigResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  className: string;
  schoolName: string;
  /** Null while loading; the instance list after a failure. */
  banks: readonly string[] | null;
}

const ConfigContext = createContext<ConfigValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const resource = useResource((signal) => getConfig({ signal }), []);
  const { data, loading, error, reload } = resource;
  const value = useMemo<ConfigValue>(
    () => ({
      config: data,
      loading,
      error,
      reload,
      className: data?.className || FALLBACK_CLASS_NAME,
      schoolName: data?.schoolName || FALLBACK_SCHOOL_NAME,
      banks: data ? data.banks : error ? BANKS : null,
    }),
    [data, loading, error, reload],
  );
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error("useConfig must be used inside <ConfigProvider>");
  return value;
}

export function useCollections(): Resource<CollectionsResponse> {
  return useResource((signal) => listCollections({ signal }), []);
}

export function useCollection(slug: string): Resource<CollectionDetail> {
  return useResource((signal) => getCollection(slug, { signal }), [slug]);
}

export function useBoard(slug: string): Resource<BoardResponse> {
  return useResource((signal) => getBoard(slug, { signal }), [slug]);
}
