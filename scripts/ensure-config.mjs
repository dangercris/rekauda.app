#!/usr/bin/env node
// Creates the local, gitignored config files from their committed examples when they are missing,
// so a fresh clone works out of the box. Never overwrites an existing file. No dependencies.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [
  ["rekauda.config.example.ts", "rekauda.config.ts", "edit it with your school's data"],
  ["wrangler.example.jsonc", "wrangler.jsonc", "fill in account_id, database_id and the R2/ratelimit names before deploying"],
  ["wrangler.cloud.example.jsonc", "wrangler.cloud.jsonc", "keep it local; scripts/cloud-guard.mjs refuses any resource shared with the pilot"],
];

for (const [example, target, hint] of files) {
  if (existsSync(root + target)) continue;
  copyFileSync(root + example, root + target);
  console.warn(`[ensure-config] ${target} was missing: copied from ${example}; ${hint}.`);
}
