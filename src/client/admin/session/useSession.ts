import { useCallback, useEffect, useRef, useState } from "react";
import { adminLogin, adminLogout, errorMessage, getAdminSession, isApiRequestError } from "../../lib/api";

export const EXPIRED_MESSAGE = "Tu sesión expiró. Ingresa de nuevo.";
export const DISABLED_MESSAGE = "El acceso de administración no está configurado.";

export type SessionState =
  | { status: "checking" }
  | { status: "signedOut"; notice: string | null }
  | { status: "signedIn" }
  /** The Worker has no ADMIN_PASSWORD / SESSION_SECRET (503 `admin_disabled`). */
  | { status: "disabled"; message: string }
  /** The session check itself failed (offline, server error): offer a retry. */
  | { status: "error"; message: string };

export interface SessionApi {
  state: SessionState;
  /** Rejects with ApiRequestError (wrong password 401, rate limit 429...) so the form can show it. */
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Any 401 from the API lands here: back to the login view with the expiry notice. */
  expire: () => void;
  retry: () => void;
}

function isDisabled(error: unknown): boolean {
  return isApiRequestError(error) && (error.code === "admin_disabled" || error.status === 503);
}

export function useSession(): SessionApi {
  const [state, setState] = useState<SessionState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "checking" });
    getAdminSession({ signal: controller.signal })
      .then((ok) => {
        if (!controller.signal.aborted) setState(ok ? { status: "signedIn" } : { status: "signedOut", notice: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isDisabled(error)) setState({ status: "disabled", message: isApiRequestError(error) ? error.message : DISABLED_MESSAGE });
        else setState({ status: "error", message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [attempt]);

  const login = useCallback(async (password: string) => {
    try {
      await adminLogin(password);
      if (mounted.current) setState({ status: "signedIn" });
    } catch (error) {
      if (isDisabled(error) && mounted.current) {
        setState({ status: "disabled", message: isApiRequestError(error) ? error.message : DISABLED_MESSAGE });
      }
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminLogout();
    } catch {
      // The cookie expires on its own; leaving the panel is what matters.
    }
    if (mounted.current) setState({ status: "signedOut", notice: null });
  }, []);

  const expire = useCallback(() => {
    setState((current) => (current.status === "signedIn" ? { status: "signedOut", notice: EXPIRED_MESSAGE } : current));
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, login, logout, expire, retry };
}
