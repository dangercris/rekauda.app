// The only code that builds a wrangler command line for the cloud scripts. It runs the guard first, refuses
// pass-through flags that could redirect wrangler (--remote, --config, --env, --env-file, --persist-to...), allows only
// local d1 actions, then spawns wrangler with a fixed local config and a persistence dir separate from the pilot's.
// The binary is a parameter of runCloudWrangler (tests inject a fake spawn). It is NEVER read from the environment:
// the CLI entry (scripts/cloud-wrangler.mjs) always passes the checkout's own wrangler. No dependencies.
//
// The sandbox:* and prod:* subcommands are the ONLY place in the repo that builds a --remote command line. Each one runs the
// sandbox guard first (workers.dev only, same account as the pilot, nothing shared with the pilot), takes no arguments
// and always passes the fixed config wrangler.sandbox.jsonc. The prod:* subcommands do the same with the production guard
// and wrangler.production.jsonc, and every one that changes something also needs a typed confirmation from a TTY.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildSandboxSeedSql } from "./cloud-sandbox-seed.mjs";
import { loadAndCheck, loadAndCheckProduction, loadAndCheckSandbox, report } from "./cloud-guard-io.mjs";
import { confirmTyped } from "./confirm.mjs";
import { runImport } from "./import/apply.mjs";
import { runImportPlan } from "./import/plan.mjs";
import { SLUG, UUID } from "./import/target.mjs";
import { runPilotCleanup, runPilotExport } from "./pilot-export.mjs";
import { openWorkdir } from "./private-workdir.mjs";

const SUBCOMMANDS = ["dev", "d1", "types"];
const SANDBOX_SUBCOMMANDS = ["sandbox:migrate", "sandbox:seed", "sandbox:deploy", "sandbox:status"];
const SANDBOX_CONFIG = ["--config", "wrangler.sandbox.jsonc"];
const PRODUCTION_CONFIG = ["--config", "wrangler.production.jsonc"];
/**
 * Production commands: apex policy of the guard, and the phrase to type (none for the read-only status).
 * IMPORTANT: wrangler deploy replaces the Worker's route list. Removing the apex entry from the config and deploying
 * DETACHES the apex and takes it offline. So prod:deploy accepts the apex entry, but whenever it is present the phrase
 * is SWITCH APEX (same gate as prod:switch-apex): attaching or keeping the apex always needs an explicit confirmation.
 */
const PRODUCTION_COMMANDS = {
  "prod:migrate": { apex: "any", phrase: "MIGRATE PRODUCTION" },
  "prod:deploy": { apex: "any", phrase: "DEPLOY PRODUCTION" },
  "prod:switch-apex": { apex: "require", phrase: "SWITCH APEX" },
  "prod:status": { apex: "any", phrase: undefined },
};
/**
 * Production data commands (they take arguments, unlike PRODUCTION_COMMANDS). The typed phrase always ends with the slug, and
 * the worker, account and root are printed before it is asked for. Each one runs its steps through productionRemote.
 */
const DATA_COMMANDS = {
  "prod:import": { phrase: "IMPORT", workdir: true, usage: "<workdir> <tenant-id> <slug>", methods: ["select", "file"], run: runImport },
};
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
 * Runs each step in order and stops at the first failure. Before EVERY spawn the guard (`checkFn`) runs again against a
 * fresh read of the files, and the config must be identical to the one first checked: a change in between is a refusal.
 */
function runSteps(steps, { root, spawn, log, env, checked, checkFn = loadAndCheckSandbox }) {
  for (const { bin, argv } of steps) {
    let again;
    try {
      again = checkFn({ root });
    } catch {
      log.error("[cloud-wrangler] REFUSED: the config could not be read again before the command ran.");
      return 1;
    }
    report(again.result, log);
    if (!again.result.ok) return 1;
    if (JSON.stringify(again.target) !== checked) {
      log.error("[cloud-wrangler] REFUSED: the wrangler config changed while the command was running.");
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

/** First guard run of a production command. A missing or unparseable config is a generic refusal, never a stack trace. */
function firstCheck(checkFn, root, log) {
  let checked;
  try {
    checked = checkFn({ root });
  } catch {
    log.error("[cloud-wrangler] REFUSED: the production config could not be read or parsed.");
    return undefined;
  }
  report(checked.result, log);
  return checked.result.ok ? checked : undefined;
}

/** Runs a production subcommand: guard with the command's apex policy, typed phrase, then fixed argv with a scrubbed env. */
function runProduction(subcommand, { root, bin, viteBin, spawn, log, env, confirm }) {
  const { apex, phrase: basePhrase } = PRODUCTION_COMMANDS[subcommand];
  const checkFn = ({ root: r }) => loadAndCheckProduction({ root: r, apex });
  const checked = firstCheck(checkFn, root, log);
  if (!checked) return 1;
  const { target } = checked;
  const phrase = subcommand === "prod:deploy" && Array.isArray(target.routes) && target.routes.length > 1 ? PRODUCTION_COMMANDS["prod:switch-apex"].phrase : basePhrase;
  if (phrase !== undefined) {
    // What the operator is about to confirm: names only, never a token.
    log.warn(`[cloud-wrangler] ${subcommand}: worker=${target.name} account=${target.account_id ?? "(not set)"} root=${target.vars.ROOT_DOMAIN}`);
  }
  if (phrase !== undefined && !confirm(phrase)) {
    log.error(`[cloud-wrangler] REFUSED: ${subcommand} needs the typed confirmation phrase on a terminal.`);
    return 1;
  }
  const run = (steps) => runSteps(steps, { root, spawn, log, env: scrubbedEnv(env), checked: JSON.stringify(target), checkFn });
  const wrangler = (...argv) => ({ bin, argv });
  if (subcommand === "prod:migrate") return run([wrangler("d1", "migrations", "apply", "DB", "--remote", ...PRODUCTION_CONFIG)]);
  if (subcommand === "prod:status") return run([wrangler("deployments", "list", ...PRODUCTION_CONFIG)]);
  return run([{ bin: viteBin, argv: ["build"] }, wrangler("deploy", ...PRODUCTION_CONFIG)]);
}

/**
 * The remote of the production data commands: `select` runs ONE SELECT, `file` runs the plan file, both as the fixed argv
 * against the fixed production config. The guard runs again before every spawn and the config must be unchanged. stdout and
 * stderr are captured and never shown (they can hold personal data). Failures are generic.
 */
export function productionRemote({ root, bin, spawn, env, log, checkFn, target, methods }) {
  const checked = JSON.stringify(target);
  const invoke = (flag, value) => {
    const again = checkFn({ root });
    report(again.result, log);
    if (!again.result.ok || JSON.stringify(again.target) !== checked) throw new Error("guard");
    const done = spawn(bin, ["d1", "execute", "DB", "--remote", "--json", ...PRODUCTION_CONFIG, flag, value], { cwd: root, env: scrubbedEnv(env), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    if (done.error || done.status !== 0) throw new Error("remote command failed");
    return String(done.stdout ?? "");
  };
  const all = {
    select(sql) {
      if (!sql.startsWith("SELECT ") || !sql.endsWith(";") || sql.slice(0, -1).includes(";")) throw new Error("not a single SELECT");
      const parsed = JSON.parse(invoke("--command", sql));
      const entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
      if (entry?.success !== true || !Array.isArray(entry.results) || entry.results.some((r) => r === null || typeof r !== "object" || Array.isArray(r))) throw new Error("unexpected result shape");
      return entry.results;
    },
    file(path) {
      if (basename(path) !== "import.sql") throw new Error("not the import plan");
      invoke("--file", path);
    },
  };
  // Least privilege: a command gets only the methods it declared in DATA_COMMANDS.
  return Object.fromEntries(methods.map((name) => [name, all[name]]));
}

/** Runs a production data command: arguments, guard, printed target, typed phrase with the slug, then the command's own steps. */
function runProductionData(subcommand, args, { root, bin, spawn, log, env, confirm, tmp }) {
  const { phrase, workdir, usage, methods, run } = DATA_COMMANDS[subcommand];
  const refuse = (why) => (log.error(`[cloud-wrangler] REFUSED: ${subcommand} ${why}`), 1);
  const [first, tenantId, slug] = workdir ? args : [undefined, ...args];
  if (args.length !== (workdir ? 3 : 2) || args.some((a) => a.startsWith("-")) || !UUID.test(tenantId) || !SLUG.test(slug)) return refuse(`takes exactly: ${usage}.`);
  let opened = {};
  if (workdir) {
    try {
      opened = openWorkdir(first, { root, tmp });
    } catch {
      return refuse("needs a workdir created by pilot:export.");
    }
  }
  const checkFn = ({ root: r }) => loadAndCheckProduction({ root: r, apex: "any" });
  const checked = firstCheck(checkFn, root, log);
  if (!checked) return 1;
  const { target } = checked;
  log.warn(`[cloud-wrangler] ${subcommand}: worker=${target.name} account=${target.account_id ?? "(not set)"} root=${target.vars.ROOT_DOMAIN} tenant=${tenantId} slug=${slug}`);
  if (!confirm(`${phrase} ${slug}`)) return refuse("needs the typed confirmation phrase on a terminal.");
  const remote = productionRemote({ root, bin, spawn, env, log, checkFn, target, methods });
  return run({ ...opened, tenantId, slug }, { remote, log });
}

/** root ends with a slash. Returns the exit status. */
export function runCloudWrangler(args, { root, bin = root + "node_modules/.bin/wrangler", viteBin = root + "node_modules/.bin/vite", spawn = spawnSync, log = console, now = () => new Date().toISOString(), env = process.env, confirm = (phrase) => confirmTyped(phrase), tmp = tmpdir() }) {
  const [subcommand, ...rest] = args;
  // The read-only pilot export lives in its own module, with its own fixed argv (see lib/pilot-export.mjs).
  if (subcommand === "pilot:export") return runPilotExport(rest, { root, bin, spawn, log, env, confirm });
  if (subcommand === "pilot:cleanup") return runPilotCleanup(rest, { root, log });
  // The import plan is local only: no wrangler, no network (see lib/import/plan.mjs).
  if (subcommand === "pilot:import:plan") return runImportPlan(rest, { root, log });
  if (Object.hasOwn(DATA_COMMANDS, subcommand)) return runProductionData(subcommand, rest, { root, bin, spawn, log, env, confirm, tmp });
  if (Object.hasOwn(PRODUCTION_COMMANDS, subcommand)) {
    const bad = forbiddenArg(rest);
    if (bad || rest.length > 0) {
      log.error(`[cloud-wrangler] REFUSED: ${subcommand} takes no arguments (${bad ?? "extra argument"} is fixed by the wrapper).`);
      return 1;
    }
    return runProduction(subcommand, { root, bin, viteBin, spawn, log, env, confirm });
  }
  if (SANDBOX_SUBCOMMANDS.includes(subcommand)) {
    const bad = forbiddenArg(rest);
    if (bad || rest.length > 0) {
      log.error(`[cloud-wrangler] REFUSED: ${subcommand} takes no arguments (${bad ?? "extra argument"} is fixed by the wrapper).`);
      return 1;
    }
    return runSandbox(subcommand, { root, bin, viteBin, spawn, log, now, env });
  }
  if (!SUBCOMMANDS.includes(subcommand)) {
    log.error(`[cloud-wrangler] REFUSED: only ${[...SUBCOMMANDS, ...SANDBOX_SUBCOMMANDS, ...Object.keys(PRODUCTION_COMMANDS), ...Object.keys(DATA_COMMANDS)].join(", ")} are allowed on this branch (plus pilot:export, pilot:cleanup and pilot:import:plan).`);
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
