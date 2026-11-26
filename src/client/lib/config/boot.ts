/**
 * Reads the config the Worker inlined in the page (`<script type="application/json" id="rekauda-config">`). A JSON data
 * block never executes, so this is plain parsing plus the same validation the server applies. Anything wrong returns null
 * and the provider asks /api/config instead: a bad tag never breaks the page and never yields half a config.
 */
import type { ConfigResponse } from "../../../shared/api";
import { parseConfigResponse } from "../../../shared/config-response";

export const BOOT_SCRIPT_ID = "rekauda-config";
/** A real config is a few KB (50 banks of 200 characters stay under this): anything bigger is not parsed. */
const MAX_BOOT_CHARS = 64 * 1024;

export function readBootConfig(doc: Document = document): ConfigResponse | null {
  const tag = doc.getElementById(BOOT_SCRIPT_ID);
  if (!tag || tag.getAttribute("type") !== "application/json") return null;
  const text = tag.textContent ?? "";
  if (text.length > MAX_BOOT_CHARS) return null;
  try {
    return parseConfigResponse(JSON.parse(text), "boot config");
  } catch {
    return null;
  }
}
