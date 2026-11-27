#!/usr/bin/env node
// Pilot safety guard CLI. Exits non-zero on any violation or error (fail closed).
//   --local | --remote   mode (required; --remote is always refused here: remote exists only through --sandbox)
//   --config <path>      cloud config (default wrangler.cloud.jsonc)
//   --sandbox            workers.dev sandbox check of wrangler.sandbox.jsonc (the only remote-capable check; no --config)
//   --production         production check of wrangler.production.jsonc (apex allowed either way; no --config)
//   --refuse-branch      used by pilot scripts on feat/cloud: always exits 1
// Pilot data comes from the local wrangler.jsonc and .pilot-resources.json (see wrangler.cloud.example.jsonc).
// Never prints ids, names or secrets. No dependencies.
import { fileURLToPath } from "node:url";
import { loadAndCheck, loadAndCheckProduction, loadAndCheckSandbox, report } from "./lib/cloud-guard-io.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(args) {
  if (args.includes("--refuse-branch")) {
    console.error("[cloud-guard] REFUSED: this branch (feat/cloud) never touches pilot resources: pilot ops scripts run from main only (deploy the pilot from main).");
    return 1;
  }
  if (args.includes("--production")) {
    if (args.length !== 1) {
      console.error("[cloud-guard] REFUSED: --production always checks wrangler.production.jsonc and takes no other flag.");
      return 1;
    }
    const { result } = loadAndCheckProduction({ root, apex: "any" });
    report(result);
    if (result.ok) console.log("[cloud-guard] OK (production)");
    return result.ok ? 0 : 1;
  }
  if (args.includes("--sandbox")) {
    if (args.includes("--config") || args.includes("--local") || args.includes("--remote")) {
      console.error("[cloud-guard] REFUSED: --sandbox always checks wrangler.sandbox.jsonc and takes no other mode or --config.");
      return 1;
    }
    const { result } = loadAndCheckSandbox({ root });
    report(result);
    if (result.ok) console.log("[cloud-guard] OK (sandbox)");
    return result.ok ? 0 : 1;
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
