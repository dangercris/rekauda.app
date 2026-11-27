// Loads the files the guard needs and runs the pure core. Any read or parse error propagates (callers fail closed).
import { existsSync, readFileSync } from "node:fs";
import { checkCloudConfig, checkSandboxConfig } from "./cloud-guard-core.mjs";
import { parseJsonc } from "./jsonc.mjs";

// Duplicate keys are refused: wrangler and this parser could otherwise disagree on which value wins.
const readJsonc = (path) => parseJsonc(readFileSync(path, "utf8"), { rejectDuplicates: true });
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

const SANDBOX_CONFIG_FILE = "wrangler.sandbox.jsonc";

/**
 * Sandbox remote check. The target file is fixed (root + wrangler.sandbox.jsonc): no caller can pick another.
 * Returns { result, target } so callers use the very config that was checked (no second read).
 */
export function loadAndCheckSandbox({ root }) {
  const target = readJsonc(root + SANDBOX_CONFIG_FILE);
  const result = checkSandboxConfig({
    target,
    targetFile: SANDBOX_CONFIG_FILE,
    pilot: readIfExists(root + "wrangler.jsonc", readJsonc),
    pilotExample: readIfExists(root + "wrangler.example.jsonc", readJsonc),
    extraDenylist: readIfExists(root + ".pilot-resources.json", (p) => JSON.parse(readFileSync(p, "utf8"))),
  });
  return { result, target };
}

export function report(result, log = console) {
  for (const warning of result.warnings) log.error(`[cloud-guard] WARNING: ${warning}`);
  for (const { field, reason } of result.violations) log.error(`[cloud-guard] REFUSED ${field}: ${reason}`);
}
