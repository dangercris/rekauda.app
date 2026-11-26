import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import type { ConfigResponse } from "../../shared/api";
import { ConfigProvider } from "../lib/config/ConfigProvider";
import { tenantA } from "./tenants";

/** Renders `ui` under a ConfigProvider that already holds `config` (no boot tag, no request). */
export function renderWithConfig(ui: ReactElement, config: ConfigResponse = tenantA): RenderResult {
  return render(<ConfigProvider initial={config}>{ui}</ConfigProvider>);
}
