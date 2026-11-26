// Loads the files the guard needs and runs the pure core. Any read or parse error propagates (callers fail closed).
import { existsSync, readFileSync } from "node:fs";
import { checkCloudConfig } from "./cloud-guard-core.mjs";
import { parseJsonc } from "./jsonc.mjs";

const readJsonc = (path) => parseJsonc(readFileSync(path, "utf8"));
const readIfExists = (path, read) => (existsSync(path) ? read(path) : null);

/** root ends with a slash. Pilot data: root wrangler.jsonc and root .pilot-resources.json (both gitignored). */
export function loadAndCheck({ root, mode, configPath = root + "wrangler.cloud.jsonc", pilotPath = root + "wrangler.jsonc" }) {
  return checkCloudConfig({
    target: readJsonc(configPath),
    pilot: readIfExists(pilotPath, readJsonc),
    pilotExample: readIfExists(root + "wrangler.example.jsonc", readJsonc),
    extraDenylist: readIfExists(root + ".pilot-resources.json", (p) => JSON.parse(readFileSync(p, "utf8"))),
    mode,
  });
}

export function report(result, log = console) {
  for (const warning of result.warnings) log.error(`[cloud-guard] WARNING: ${warning}`);
  for (const { field, reason } of result.violations) log.error(`[cloud-guard] REFUSED ${field}: ${reason}`);
}
