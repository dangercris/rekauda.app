import { useCallback, useEffect, useRef, useState } from "react";
import { adminLogin, adminLogout, errorMessage, getAdminSession, isApiRequestError, verifyMagicLink } from "../../lib/api";
import { forgetLinkToken, takeLinkToken } from "./linkLogin";

export const EXPIRED_MESSAGE = "Tu sesión expiró. Ingresa de nuevo.";
export const DISABLED_MESSAGE = "El acceso de administración no está configurado.";

export type SessionState =
  | { status: "checking" }
  | { status: "signedOut"; notice: string | null }
  | { status: "signedIn" }
  /** The page was opened from an emailed link: waits for a click before using it. */
  | { status: "confirmLink" }
  /** The Worker has no ADMIN_PASSWORD (503 `admin_disabled`). */
  | { status: "disabled"; message: string }
  /** The session check itself failed (offline, server error): offer a retry. */
  | { status: "error"; message: string };

export interface SessionApi {
  state: SessionState;
  /** Rejects with ApiRequestError (wrong password 401, rate limit 429...) so the form can show it. */
  login: (password: string) => Promise<void>;
  /** Uses the emailed link's token (only after the user clicked). Failures land in `signedOut` with a notice. */
  confirmLink: () => Promise<void>;
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
  // Set when the page was opened from an emailed link. It is only a pending offer: nothing is sent until the user confirms.
  const [link] = useState(takeLinkToken);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (link && attempt === 0) {
      setState({ status: "confirmLink" });
      return;
    }
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
  }, [attempt, link]);

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

  const confirmLink = useCallback(async () => {
    if (!link) return;
    forgetLinkToken();
    setState({ status: "checking" });
    try {
      await verifyMagicLink(link);
      if (mounted.current) setState({ status: "signedIn" });
    } catch (error) {
      if (mounted.current) setState({ status: "signedOut", notice: errorMessage(error) });
    }
  }, [link]);

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

  return { state, login, confirmLink, logout, expire, retry };
}
