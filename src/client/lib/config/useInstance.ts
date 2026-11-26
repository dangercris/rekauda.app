import { createContext, useContext } from "react";
import type { ConfigResponse } from "../../../shared/api";
import type { Instance } from "../../../shared/instance";

/** The validated config of the tenant that serves this page, plus the derived display values and the sign-in mode. */
export interface ClientInstance extends Instance {
  readonly auth: ConfigResponse["auth"];
}

export const InstanceContext = createContext<ClientInstance | null>(null);

/** Tenant values for components. The provider renders children only once the config is known, so this never returns null. */
export function useInstanceConfig(): ClientInstance {
  const value = useContext(InstanceContext);
  if (!value) throw new Error("useInstanceConfig must be used inside <ConfigProvider>");
  return value;
}
