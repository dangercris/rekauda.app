// The only code that builds a wrangler command line for the cloud scripts. It runs the guard first, refuses
// pass-through flags that could redirect wrangler (--remote, --config, --env, --env-file, --persist-to...), allows only
// local d1 actions, then spawns wrangler with a fixed local config and a persistence dir separate from the pilot's.
// The binary is a parameter of runCloudWrangler (tests inject a fake spawn). It is NEVER read from the environment:
// the CLI entry (scripts/cloud-wrangler.mjs) always passes the checkout's own wrangler. No dependencies.
import { spawnSync } from "node:child_process";
import { loadAndCheck, report } from "./cloud-guard-io.mjs";

const SUBCOMMANDS = ["dev", "d1", "types"];
const D1_ACTIONS = ["execute", "migrations"];
const FORBIDDEN_LONG = ["--remote", "--config", "--env", "--env-file", "--persist-to", "--local"];

/** Reason the pass-through args are refused, or undefined when they are acceptable. */
function forbiddenArg(args) {
  for (const arg of args) {
    const long = FORBIDDEN_LONG.find((flag) => arg === flag || arg.startsWith(`${flag}=`));
    if (long && !(long === "--local" && arg === "--local")) return arg.split("=")[0];
    if (/^-[ce]/.test(arg) && !arg.startsWith("--")) return arg.slice(0, 2);
  }
  return undefined;
}

/** root ends with a slash. Returns the exit status. */
export function runCloudWrangler(args, { root, bin = root + "node_modules/.bin/wrangler", spawn = spawnSync, log = console }) {
  const [subcommand, ...rest] = args;
  if (!SUBCOMMANDS.includes(subcommand)) {
    log.error(`[cloud-wrangler] REFUSED: only ${SUBCOMMANDS.join(", ")} are allowed on this branch.`);
    return 1;
  }
  if (subcommand === "d1" && !D1_ACTIONS.includes(rest[0])) {
    log.error(`[cloud-wrangler] REFUSED: d1 allows only ${D1_ACTIONS.join(", ")}.`);
    return 1;
  }
  const bad = forbiddenArg(rest);
  if (bad) {
    log.error(`[cloud-wrangler] REFUSED: ${bad} is fixed by the wrapper and cannot be passed.`);
    return 1;
  }
  const result = loadAndCheck({ root, mode: "local" });
  report(result, log);
  if (!result.ok) return 1;

  const final = [subcommand, ...rest];
  if (subcommand === "d1" && !rest.includes("--local")) final.push("--local");
  final.push("--config", "wrangler.cloud.jsonc");
  if (subcommand !== "types") final.push("--persist-to", ".wrangler/state-cloud");
  return spawn(bin, final, { cwd: root, stdio: "inherit" }).status ?? 1;
}
