#!/usr/bin/env node
// Pilot safety guard CLI. Exits non-zero on any violation or error (fail closed).
//   --local | --remote   mode (required; --remote is always refused in phase 1)
//   --config <path>      cloud config (default wrangler.cloud.jsonc)
//   --refuse-branch      used by pilot scripts on feat/cloud: always exits 1
// Pilot data comes from the local wrangler.jsonc and .pilot-resources.json (see wrangler.cloud.example.jsonc).
// Never prints ids, names or secrets. No dependencies.
import { fileURLToPath } from "node:url";
import { loadAndCheck, report } from "./lib/cloud-guard-io.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(args) {
  if (args.includes("--refuse-branch")) {
    console.error("[cloud-guard] REFUSED: this branch (feat/cloud) never touches pilot resources: pilot ops scripts run from main only (deploy the pilot from main).");
    return 1;
  }
  const mode = args.includes("--remote") ? "remote" : args.includes("--local") ? "local" : undefined;
  const configIndex = args.indexOf("--config");
  const configPath = configIndex === -1 ? undefined : args[configIndex + 1];
  const result = loadAndCheck({ root, mode, configPath });
  report(result);
  if (result.ok) console.log(`[cloud-guard] OK (${mode})`);
  return result.ok ? 0 : 1;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  // Fail closed. Print only the error class, never its message (it could echo file contents).
  console.error(`[cloud-guard] REFUSED: could not verify the configuration (${error?.name ?? "Error"}).`);
  process.exitCode = 1;
}
