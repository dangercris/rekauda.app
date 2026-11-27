// pilot:import:plan <workdir>: local only, it never touches the network or any remote resource. It takes the
// latest pilot export from the private workdir, runs the preflight, and writes the generated INSERT file (0600) into the
// same workdir. The tenant id is NOT an argument: it is the one prod:provision recorded in the manifest. It prints counts only. Refuses unless two exports of the pilot matched and no mismatch was ever seen.
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { hash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalHash } from "../pilot-export.mjs";
import { openWorkdir, writeManifest } from "../private-workdir.mjs";
import { buildImportSql, MAX_BYTES } from "./chunk.mjs";
import { IMPORT_TABLES } from "./columns.mjs";
import { assertNodeVersion, loadSnapshot } from "./pilot-snapshot.mjs";
import { runPreflight } from "./preflight.mjs";
import { SLUG, UUID } from "./target.mjs";
import { transform } from "./transform.mjs";

export const PLAN_FILE = "import.sql";

/** The freeze must be proven: at least two exports, no mismatch ever seen, and the latest one equal to the first. */
export function checkManifestGate(manifest) {
  const list = Array.isArray(manifest?.exports) ? manifest.exports : [];
  const ok = list.length >= 2 && manifest.mismatchSeen !== true && list.at(-1).matchesFirst === true;
  return { ok };
}

const sha256 = (text) => hash("sha256", text, "hex");

/**
 * What prod:import and prod:validate rely on: the plan recorded in the manifest must still be the one in force. It must be
 * for this tenant, built from the latest export (which must still pass the freeze gate and match its hash), the SQL file
 * must hash as recorded, and rebuilding the plan from that export must give the same bytes. Throws a generic error otherwise.
 * Returns the transformed Cloud rows (for the collision check and the validation) and the file to execute.
 */
export function loadPlanState(dir, manifest, tenantId) {
  const plan = manifest?.plan;
  const latest = Array.isArray(manifest?.exports) ? manifest.exports.at(-1) : undefined;
  if (!plan || !latest || plan.file !== PLAN_FILE || plan.tenantId !== tenantId || plan.exportFile !== latest.file || plan.exportHash !== latest.hash || !checkManifestGate(manifest).ok) throw new Error("stale plan");
  const tables = JSON.parse(readFileSync(join(dir, latest.file), "utf8")).tables;
  const path = join(dir, PLAN_FILE);
  if (canonicalHash(tables) !== latest.hash || sha256(readFileSync(path, "utf8")) !== plan.sha256) throw new Error("stale plan");
  const db = loadSnapshot(tables);
  try {
    if (!runPreflight(db, tables).ok) throw new Error("stale plan");
    const cloud = transform(db, { tenantId });
    if (sha256(buildImportSql(cloud).join("\n") + "\n") !== plan.sha256) throw new Error("stale plan");
    return { tables: cloud, path, sha256: plan.sha256 };
  } finally {
    db.close();
  }
}

/**
 * The ids of the plan, for the undo: which rows an import of THIS plan can have created. Only needs the plan record to be
 * for this tenant and its export file to hash as recorded (a newer export does not matter: the undo must still work then).
 * Returns { ids: { collections, payments, bank_movements } as Sets, students: count }. Throws a generic error otherwise.
 */
export function loadPlanIds(dir, manifest, tenantId) {
  const plan = manifest?.plan;
  if (!plan || plan.file !== PLAN_FILE || plan.tenantId !== tenantId || typeof plan.exportFile !== "string") throw new Error("no plan");
  const tables = JSON.parse(readFileSync(join(dir, plan.exportFile), "utf8")).tables;
  if (canonicalHash(tables) !== plan.exportHash) throw new Error("no plan");
  const db = loadSnapshot(tables);
  try {
    const cloud = transform(db, { tenantId });
    return { ids: Object.fromEntries(["collections", "payments", "bank_movements"].map((t) => [t, new Set(cloud[t].map((row) => row.id))])), students: cloud.students.length };
  } finally {
    db.close();
  }
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
  if (args.length !== 1 || args[0].startsWith("-")) return refuse("pass exactly one argument: the workdir.");
  try {
    assertNodeVersion();
    const { dir, manifest } = openWorkdir(args[0], { root, tmp });
    // A plan from an earlier run must never survive a run that refuses or fails.
    rmSync(join(dir, PLAN_FILE), { force: true });
    if (manifest.plan !== undefined) {
      delete manifest.plan;
      writeManifest(dir, manifest);
    }
    const tenantId = manifest.tenant?.id;
    if (typeof tenantId !== "string" || !UUID.test(tenantId) || typeof manifest.tenant.slug !== "string" || !SLUG.test(manifest.tenant.slug) || manifest.tenant.state !== "provisioned") return refuse("the workdir has no finished provisioning; run prod:provision first (or prod:undo-tenant if an earlier run did not finish).");
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
    const statements = buildImportSql(transform(db, { tenantId }));
    if (statements.some((s) => Buffer.byteLength(s, "utf8") > MAX_BYTES)) throw new Error("x");
    const text = statements.join("\n") + "\n";
    writePlan(join(dir, PLAN_FILE), text);
    writeManifest(dir, { ...manifest, plan: { file: PLAN_FILE, sha256: sha256(text), tenantId, exportFile: latest.file, exportHash: latest.hash } });
    log.log(`[import-plan] ${statements.length} statements written to ${PLAN_FILE} in the workdir.`);
    return 0;
  } catch {
    return refuse("the plan could not be built (no details are shown on purpose).");
  }
}
