// The only code that builds a wrangler command line for the cloud scripts. It runs the guard first, refuses
// pass-through flags that could redirect wrangler (--remote, --config, --env, --env-file, --persist-to...), allows only
// local d1 actions, then spawns wrangler with a fixed local config and a persistence dir separate from the pilot's.
// The binary is a parameter of runCloudWrangler (tests inject a fake spawn). It is NEVER read from the environment:
// the CLI entry (scripts/cloud-wrangler.mjs) always passes the checkout's own wrangler. No dependencies.
//
// The sandbox:* subcommands are the ONLY place in the repo that builds a --remote command line. Each one runs the
// sandbox guard first (workers.dev only, same account as the pilot, nothing shared with the pilot), takes no arguments
// and always passes the fixed config wrangler.sandbox.jsonc.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSandboxSeedSql } from "./cloud-sandbox-seed.mjs";
import { loadAndCheck, loadAndCheckSandbox, report } from "./cloud-guard-io.mjs";

const SUBCOMMANDS = ["dev", "d1", "types"];
const SANDBOX_SUBCOMMANDS = ["sandbox:migrate", "sandbox:seed", "sandbox:deploy", "sandbox:status"];
const SANDBOX_CONFIG = ["--config", "wrangler.sandbox.jsonc"];
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

/** Environment variables a sandbox child process may see. Everything else (CLOUDFLARE_ENV, WRANGLER_*, API base URLs...) is dropped. */
const SANDBOX_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "NODE_ENV"];
const scrubbedEnv = (env) => Object.fromEntries(SANDBOX_ENV_KEYS.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));

/**
 * Runs each step in order and stops at the first failure. Before EVERY spawn the sandbox guard runs again against a fresh
 * read of the files, and the config must be identical to the one first checked: a change in between is a refusal.
 */
function runSteps(steps, { root, spawn, log, env, checked }) {
  for (const { bin, argv } of steps) {
    const again = loadAndCheckSandbox({ root });
    report(again.result, log);
    if (!again.result.ok) return 1;
    if (JSON.stringify(again.target) !== checked) {
      log.error("[cloud-wrangler] REFUSED: wrangler.sandbox.jsonc changed while the command was running.");
      return 1;
    }
    const status = spawn(bin, argv, { cwd: root, stdio: "inherit", env }).status ?? 1;
    if (status !== 0) return status;
  }
  return 0;
}

/** Runs a sandbox subcommand. The guard runs first and its target is the config that is then used. */
function runSandbox(subcommand, { root, bin, viteBin, spawn, log, now, env }) {
  const { result, target } = loadAndCheckSandbox({ root });
  report(result, log);
  if (!result.ok) return 1;
  const workers = target.vars.SANDBOX_WORKERS;
  const run = (steps) => runSteps(steps, { root, spawn, log, env: scrubbedEnv(env), checked: JSON.stringify(target) });
  const wrangler = (...argv) => ({ bin, argv });
  if (subcommand === "sandbox:migrate") return run([wrangler("d1", "migrations", "apply", "DB", "--remote", ...SANDBOX_CONFIG)]);
  if (subcommand === "sandbox:status") return run(workers.map((w) => wrangler("deployments", "list", ...SANDBOX_CONFIG, "--name", w)));
  if (subcommand === "sandbox:deploy") return run([{ bin: viteBin, argv: ["build"] }, ...workers.map((w) => wrangler("deploy", ...SANDBOX_CONFIG, "--name", w))]);
  // sandbox:seed: the SQL goes to a private temp dir that is removed afterwards.
  const sql = buildSandboxSeedSql({ workers, rootDomain: target.vars.ROOT_DOMAIN, now: now() });
  const dir = mkdtempSync(join(tmpdir(), "rekauda-sandbox-seed-"));
  try {
    const file = join(dir, "seed.sql");
    writeFileSync(file, sql);
    return run([wrangler("d1", "execute", "DB", "--remote", "--file", file, ...SANDBOX_CONFIG)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** root ends with a slash. Returns the exit status. */
export function runCloudWrangler(args, { root, bin = root + "node_modules/.bin/wrangler", viteBin = root + "node_modules/.bin/vite", spawn = spawnSync, log = console, now = () => new Date().toISOString(), env = process.env }) {
  const [subcommand, ...rest] = args;
  if (SANDBOX_SUBCOMMANDS.includes(subcommand)) {
    const bad = forbiddenArg(rest);
    if (bad || rest.length > 0) {
      log.error(`[cloud-wrangler] REFUSED: ${subcommand} takes no arguments (${bad ?? "extra argument"} is fixed by the wrapper).`);
      return 1;
    }
    return runSandbox(subcommand, { root, bin, viteBin, spawn, log, now, env });
  }
  if (!SUBCOMMANDS.includes(subcommand)) {
    log.error(`[cloud-wrangler] REFUSED: only ${[...SUBCOMMANDS, ...SANDBOX_SUBCOMMANDS].join(", ")} are allowed on this branch.`);
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
