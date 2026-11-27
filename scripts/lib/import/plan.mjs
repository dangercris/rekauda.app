// pilot:import:plan <workdir> <tenant-id>: local only, it never touches the network or any remote resource. It takes the
// latest pilot export from the private workdir, runs the preflight, and writes the generated INSERT file (0600) into the
// same workdir. It prints counts only. Refuses unless two exports of the pilot matched and no mismatch was ever seen.
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalHash } from "../pilot-export.mjs";
import { openWorkdir } from "../private-workdir.mjs";
import { buildImportSql, MAX_BYTES } from "./chunk.mjs";
import { IMPORT_TABLES } from "./columns.mjs";
import { assertNodeVersion, loadSnapshot } from "./pilot-snapshot.mjs";
import { runPreflight } from "./preflight.mjs";
import { transform } from "./transform.mjs";

export const PLAN_FILE = "import.sql";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The freeze must be proven: at least two exports, no mismatch ever seen, and the latest one equal to the first. */
export function checkManifestGate(manifest) {
  const list = Array.isArray(manifest?.exports) ? manifest.exports : [];
  const ok = list.length >= 2 && manifest.mismatchSeen !== true && list.at(-1).matchesFirst === true;
  return { ok };
}

/** Writes through a temp file created exclusively (O_EXCL) with mode 0600, then renames it into place. */
function writePlan(path, text) {
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeSync(fd, text);
    closeSync(fd);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function runImportPlan(args, { root, log = console, tmp = tmpdir() }) {
  const refuse = (why) => (log.error(`[import-plan] REFUSED: ${why}`), 1);
  if (args.length !== 2 || args.some((a) => a.startsWith("-"))) return refuse("pass exactly two arguments: the workdir and the tenant id.");
  if (!UUID.test(args[1])) return refuse("the tenant id must be the UUID printed by provisioning.");
  try {
    assertNodeVersion();
    const { dir, manifest } = openWorkdir(args[0], { root, tmp });
    // A plan from an earlier run must never survive a run that refuses or fails.
    rmSync(join(dir, PLAN_FILE), { force: true });
    if (!checkManifestGate(manifest).ok) return refuse("needs two matching pilot exports and no mismatch ever seen.");
    const latest = manifest.exports.at(-1);
    const tables = JSON.parse(readFileSync(join(dir, latest.file), "utf8")).tables;
    if (canonicalHash(tables) !== latest.hash) return refuse("the latest export does not match its recorded hash.");
    const db = loadSnapshot(tables);
    const pre = runPreflight(db, tables);
    log.log(`[import-plan] ${IMPORT_TABLES.map((t) => `${t}=${pre.counts[t]}`).join(" ")}`);
    if (!pre.ok) {
      log.error(`[import-plan] PREFLIGHT FAILED (counts only): ${pre.failures.map((f) => `${f.check}=${f.count}`).join(" ")}`);
      return 1;
    }
    const statements = buildImportSql(transform(db, { tenantId: args[1] }));
    if (statements.some((s) => Buffer.byteLength(s, "utf8") > MAX_BYTES)) throw new Error("x");
    writePlan(join(dir, PLAN_FILE), statements.join("\n") + "\n");
    log.log(`[import-plan] ${statements.length} statements written to ${PLAN_FILE} in the workdir.`);
    return 0;
  } catch {
    return refuse("the plan could not be built (no details are shown on purpose).");
  }
}
