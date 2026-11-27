// pilot:export and pilot:cleanup. The export is the ONLY code that reads the pilot, and it can only read: one fixed batch
// of SELECT statements, run as a fixed argv with a scrubbed env and a generated config that holds only the pilot D1 entry
// and the account id (0600, in the private workdir). The config is passed explicitly with --config, so wrangler never
// searches parent directories for one, and the database is pinned by id as well as by name. Nothing passes through from the command line, and the output goes to a file in
// the 0700 workdir, never to the terminal. It prints only counts, a content hash and MATCH or MISMATCH.
// The pilot database name and account id come from the gitignored local reference and are never printed. No dependencies.
import { spawnSync } from "node:child_process";
import { hash as digest } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPilotReference, report } from "./cloud-guard-io.mjs";
import { confirmTyped } from "./confirm.mjs";
import { cleanupWorkdir, createWorkdir, openWorkdir, writeManifest } from "./private-workdir.mjs";

export const EXPORT_PHRASE = "EXPORT PILOT READ-ONLY";
export const EXPORT_TABLES = ["collections", "payments", "students", "bank_movements"];
export const EXPORT_STATEMENTS = EXPORT_TABLES.map((table) => `SELECT * FROM ${table} ORDER BY id;`);
export const SELECT_BATCH = EXPORT_STATEMENTS.join(" ");

/** Environment variables the child may see. The account id is not taken from here: it comes from the pilot reference. */
const ENV_KEYS = ["PATH", "HOME", "TMPDIR", "CLOUDFLARE_API_TOKEN", "NODE_ENV"];
const MAX_OUTPUT = 512 * 1024 * 1024;
const MISMATCH_STATUS = 3;
const GENERATED_CONFIG = "pilot-d1.jsonc";

/** The one and only remote command line of the pilot export. */
function buildExportArgv(dbName, configPath) {
  return ["d1", "execute", dbName, "--remote", "--json", "--config", configPath, "--command", SELECT_BATCH];
}

const childEnv = (env, accountId) => ({ ...Object.fromEntries(ENV_KEYS.filter((key) => env[key] !== undefined).map((key) => [key, env[key]])), CLOUDFLARE_ACCOUNT_ID: accountId });

/** JSON with object keys sorted at every level, so key order never changes the hash. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const canonicalHash = (tables) => digest("sha256", canonical(tables), "hex");

/** Turns the wrangler JSON (one entry per statement) into { table: rows }. Throws on any unexpected shape. */
function parseTables(stdout) {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== EXPORT_TABLES.length) throw new Error("unexpected result shape");
  const tables = {};
  parsed.forEach((entry, i) => {
    if (entry?.success !== true || !Array.isArray(entry.results) || entry.results.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) throw new Error("unexpected result shape");
    tables[EXPORT_TABLES[i]] = entry.results;
  });
  return tables;
}

/** The only config the export uses: the pilot D1 entry and the account id, nothing else (no routes, no vars). */
const generatedConfig = (ref) => JSON.stringify({ account_id: ref.accountId, d1_databases: [{ binding: "DB", database_name: ref.dbName, database_id: ref.dbId }] });

/** Args: at most one positional (an existing workdir). Flags are never accepted. */
export function runPilotExport(args, { root, bin, spawn = spawnSync, log = console, env = process.env, confirm = (phrase) => confirmTyped(phrase), tmp = tmpdir(), now = () => new Date().toISOString() }) {
  if (args.length > 1 || args.some((a) => a.startsWith("-"))) {
    log.error("[pilot-export] REFUSED: it takes at most one argument, an existing workdir. Nothing else is configurable.");
    return 1;
  }
  let ref;
  try {
    ref = loadPilotReference({ root });
  } catch {
    log.error("[pilot-export] REFUSED: the pilot reference could not be read.");
    return 1;
  }
  report(ref.result, log);
  if (!ref.result.ok) return 1;
  let existing;
  if (args.length === 1) {
    try {
      existing = openWorkdir(args[0], { root, tmp });
    } catch {
      log.error("[pilot-export] REFUSED: the argument is not a pilot workdir created by this tool.");
      return 1;
    }
  }
  log.warn("[pilot-export] Use a read-only D1 API token for this step. The tool cannot verify the token's permissions.");
  if (!confirm(EXPORT_PHRASE)) {
    log.error("[pilot-export] REFUSED: needs the typed confirmation phrase on a terminal.");
    return 1;
  }
  let dir;
  let fresh = false;
  try {
    dir = existing ? existing.dir : createWorkdir({ root, tmp, now });
    fresh = !existing;
    const manifest = existing ? existing.manifest : openWorkdir(dir, { root, tmp }).manifest;
    writeFileSync(join(dir, GENERATED_CONFIG), generatedConfig(ref), { mode: 0o600 });
    const result = spawn(bin, buildExportArgv(ref.dbName, join(dir, GENERATED_CONFIG)), { cwd: dir, env: childEnv(env, ref.accountId), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: MAX_OUTPUT });
    if (result.error || result.status !== 0) throw new Error("wrangler failed");
    const tables = parseTables(String(result.stdout));
    const number = manifest.exports.length + 1;
    const file = `export-${number}.json`;
    const hash = canonicalHash(tables);
    const first = manifest.exports[0];
    const counts = Object.fromEntries(EXPORT_TABLES.map((t) => [t, tables[t].length]));
    writeFileSync(join(dir, file), JSON.stringify({ version: 1, tables }), { mode: 0o600 });
    // The FIRST export is the reference, and one difference is remembered for good: repeating the changed content
    // (or going back to the first hash) can never turn a MISMATCH into a MATCH.
    const matchesFirst = first ? first.hash === hash : null;
    if (matchesFirst === false) manifest.mismatchSeen = true;
    manifest.exports.push({ file, hash, counts, at: now(), matchesFirst });
    writeManifest(dir, manifest);
    log.log(`[pilot-export] workdir=${dir}`);
    log.log(`[pilot-export] ${file} ${EXPORT_TABLES.map((t) => `${t}=${counts[t]}`).join(" ")} hash=${hash}`);
    if (!first) return 0;
    const mismatch = manifest.mismatchSeen === true;
    log.log(`[pilot-export] vs first export: ${mismatch ? "MISMATCH" : "MATCH"}`);
    if (!mismatch) return 0;
    log.error("[pilot-export] The pilot changed between exports. Do not import this data.");
    return MISMATCH_STATUS;
  } catch {
    log.error("[pilot-export] FAILED: nothing was exported (no output is shown on purpose).");
    if (fresh && dir) {
      try {
        cleanupWorkdir(dir, { root, tmp });
      } catch {
        log.error("[pilot-export] could not remove the workdir; run pilot:cleanup on the rekauda-pilot-* directory in the OS tmp dir.");
      }
    }
    return 1;
  }
}

/** pilot:cleanup <workdir>: removes a marked workdir. */
export function runPilotCleanup(args, { root, log = console, tmp = tmpdir() }) {
  if (args.length !== 1 || args[0].startsWith("-")) {
    log.error("[pilot-cleanup] REFUSED: pass exactly one argument, the workdir to remove.");
    return 1;
  }
  try {
    cleanupWorkdir(args[0], { root, tmp });
  } catch {
    log.error("[pilot-cleanup] REFUSED: the argument is not a pilot workdir created by this tool. Nothing was deleted.");
    return 1;
  }
  log.log("[pilot-cleanup] workdir removed.");
  return 0;
}
