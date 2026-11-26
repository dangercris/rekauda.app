#!/usr/bin/env node
// The only way cloud scripts reach wrangler. Usage: node scripts/cloud-wrangler.mjs <dev|d1|types> [args]
// The logic lives in lib/cloud-wrangler-core.mjs. This entry always runs the checkout's own wrangler: no environment
// variable can swap the binary. Any throw fails closed. No dependencies.
import { fileURLToPath } from "node:url";
import { runCloudWrangler } from "./lib/cloud-wrangler-core.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
  process.exitCode = runCloudWrangler(process.argv.slice(2), { root });
} catch (error) {
  console.error(`[cloud-wrangler] REFUSED: could not verify the configuration (${error?.name ?? "Error"}).`);
  process.exitCode = 1;
}
