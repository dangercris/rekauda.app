import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { errorMessage, isApiRequestError } from "../../lib/publicApi";

export interface Resource<T> {
  data: T | null;
  /** True during the first load and during reloads (data stays visible while reloading). */
  loading: boolean;
  /** Spanish message safe to show, or null. */
  error: string | null;
  /** HTTP status of the last failure (0 for network/timeout), or null. */
  errorStatus: number | null;
  reload: () => void;
}

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
}

/**
 * Loads data with an AbortController tied to the component lifetime (and to `deps`).
 * Aborted requests never update state; `reload()` refetches keeping the current data on screen.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): Resource<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null, errorStatus: null });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastDeps = useRef<DependencyList | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const depsChanged = lastDeps.current === null || deps.some((d, i) => !Object.is(d, lastDeps.current?.[i]));
    lastDeps.current = deps;
    setState((s) => ({ data: depsChanged ? null : s.data, loading: true, error: null, errorStatus: null }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null, errorStatus: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({
          data: s.data,
          loading: false,
          error: errorMessage(error),
          errorStatus: isApiRequestError(error) ? error.status : 0,
        }));
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list.
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
