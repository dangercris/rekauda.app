import { createContext, useCallback, useContext, type ReactNode } from "react";
import { isApiRequestError } from "../../lib/api";

export interface SessionActions {
  expire: () => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionActions | null>(null);

export function SessionProvider({ value, children }: { value: SessionActions; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionActions(): SessionActions {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSessionActions must be used inside <SessionProvider>");
  return value;
}

export function isUnauthorized(error: unknown): boolean {
  return isApiRequestError(error) && error.status === 401;
}

export function isAborted(error: unknown): boolean {
  return isApiRequestError(error) && error.code === "aborted";
}

/**
 * Returns a handler for caught API errors: a 401 expires the session (back to login with a notice)
 * and returns true so callers skip their own error UI; aborted requests are ignored too.
 */
export function useApiErrorGate(): (error: unknown) => boolean {
  const { expire } = useSessionActions();
  return useCallback(
    (error: unknown) => {
      if (isAborted(error)) return true;
      if (isUnauthorized(error)) {
        expire();
        return true;
      }
      return false;
    },
    [expire],
  );
}
