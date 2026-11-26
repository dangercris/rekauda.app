import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ConfigResponse } from "../../../shared/api";
import { parseConfigResponse } from "../../../shared/config-response";
import { monthYearEs } from "../../../shared/instance-validation";
import { Button, EmptyState, Skeleton } from "../../ui";
import { isApiRequestError } from "../api";
import { getConfig } from "../publicApi";
import { readBootConfig } from "./boot";
import { InstanceContext, type ClientInstance } from "./useInstance";

type State = { status: "ready"; instance: ClientInstance } | { status: "loading" } | { status: "error"; notFound: boolean };

function toInstance(config: ConfigResponse): ClientInstance {
  return { ...config, earliestTransferLabel: monthYearEs(config.earliestTransferDate) };
}

/** Boot JSON first (synchronous, no flash). Otherwise one request to /api/config with loading, error and not-found states. */
function initialState(initial: ConfigResponse | undefined): State {
  let config: ConfigResponse | null;
  try {
    config = initial ? parseConfigResponse(initial, "initial config") : readBootConfig();
  } catch {
    config = null;
  }
  return config ? { status: "ready", instance: toInstance(config) } : { status: "loading" };
}

export interface ConfigProviderProps {
  children: ReactNode;
  /** A config already in hand (tests, gallery). Skips the boot tag and the request. */
  initial?: ConfigResponse | undefined;
}

export function ConfigProvider({ children, initial }: ConfigProviderProps) {
  const [state, setState] = useState<State>(() => initialState(initial));
  const [attempt, setAttempt] = useState(0);
  const needsFetch = state.status !== "ready";

  useEffect(() => {
    if (!needsFetch) return undefined;
    const controller = new AbortController();
    getConfig({ signal: controller.signal }).then(
      (raw) => {
        if (controller.signal.aborted) return;
        try {
          setState({ status: "ready", instance: toInstance(parseConfigResponse(raw, "/api/config")) });
        } catch {
          setState({ status: "error", notFound: false });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", notFound: isApiRequestError(error) && error.status === 404 });
      },
    );
    return () => controller.abort();
  }, [needsFetch, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  if (state.status === "ready") return <InstanceContext.Provider value={state.instance}>{children}</InstanceContext.Provider>;
  if (state.status === "loading") {
    return (
      <div aria-busy="true">
        <span className="visually-hidden" role="status">
          Cargando…
        </span>
        <Skeleton height={34} width="60%" />
        <Skeleton height={14} lines={3} />
      </div>
    );
  }
  return (
    <div role="alert">
      <EmptyState
        title={state.notFound ? "Esta página no existe" : "No pudimos cargar la configuración"}
        description={state.notFound ? "Revisa la dirección e intenta de nuevo." : "Revisa tu conexión e intenta de nuevo."}
        action={state.notFound ? undefined : <Button variant="glass" size="sm" iconStart="refresh" onClick={retry}>Reintentar</Button>}
      />
    </div>
  );
}
