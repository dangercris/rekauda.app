#!/usr/bin/env node
// The only way cloud scripts reach wrangler. It runs the guard first, refuses pass-through flags that could
// redirect wrangler (--remote, --config, --env, --persist-to...), then spawns wrangler with a fixed local config
// and a persistence dir separate from the pilot's. Usage: node scripts/cloud-wrangler.mjs <dev|d1|types> [args]
// CLOUD_WRANGLER_BIN replaces the wrangler binary (tests use a stub). No dependencies.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAndCheck, report } from "./lib/cloud-guard-io.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SUBCOMMANDS = ["dev", "d1", "types"];
const FORBIDDEN_LONG = ["--remote", "--config", "--env", "--persist-to", "--local"];

/** Reason the pass-through args are refused, or undefined when they are acceptable. */
function forbiddenArg(args) {
  for (const arg of args) {
    const long = FORBIDDEN_LONG.find((flag) => arg === flag || arg.startsWith(`${flag}=`));
    if (long && !(long === "--local" && arg === "--local")) return arg.split("=")[0];
    if (/^-[ce]/.test(arg) && !arg.startsWith("--")) return arg.slice(0, 2);
  }
  return undefined;
}

function run(args) {
  const [subcommand, ...rest] = args;
  if (!SUBCOMMANDS.includes(subcommand)) {
    console.error(`[cloud-wrangler] REFUSED: only ${SUBCOMMANDS.join(", ")} are allowed on this branch.`);
    return 1;
  }
  const bad = forbiddenArg(rest);
  if (bad) {
    console.error(`[cloud-wrangler] REFUSED: ${bad} is fixed by the wrapper and cannot be passed.`);
    return 1;
  }
  const result = loadAndCheck({ root, mode: "local" });
  report(result);
  if (!result.ok) return 1;

  const final = [subcommand, ...rest];
  if (subcommand === "d1" && !rest.includes("--local")) final.push("--local");
  final.push("--config", "wrangler.cloud.jsonc");
  if (subcommand !== "types") final.push("--persist-to", ".wrangler/state-cloud");

  const stub = process.env.CLOUD_WRANGLER_BIN;
  const [bin, binArgs] = stub ? [process.execPath, [stub]] : [root + "node_modules/.bin/wrangler", []];
  return spawnSync(bin, [...binArgs, ...final], { cwd: root, stdio: "inherit" }).status ?? 1;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error(`[cloud-wrangler] REFUSED: could not verify the configuration (${error?.name ?? "Error"}).`);
  process.exitCode = 1;
}
