// prod:import, the apply step. Order matters and nothing is skipped: the plan must be in force (loadPlanState), the target
// preflight runs with REAL reads right now (tenant source pilot_import, zero rows, no id collision), the SQL file is hashed
// once more, and only then the file produced by pilot:import:plan is executed, whole. `remote` is injected: the wrapper
// builds it behind the production guard. Output has counts and check names only, never rows. No dependencies.
import { hash } from "node:crypto";
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { loadPlanState } from "./plan.mjs";
import { SLUG, UUID, targetVerdict } from "./target.mjs";

const sha256 = (bytes) => hash("sha256", bytes, "hex");

/**
 * Copies the VERIFIED bytes into a fresh private subdirectory (0700) as import.sql, created exclusively (O_EXCL, 0600), and
 * checks the copy again. What is executed is that copy, so a change to the plan file after the check cannot reach the
 * remote. Returns { copyDir, copy }; the caller removes copyDir.
 */
function privateCopy(dir, bytes, expected) {
  const copyDir = mkdtempSync(join(dir, "run-"));
  try {
    chmodSync(copyDir, 0o700);
    const copy = join(copyDir, "import.sql");
    const fd = openSync(copy, "wx", 0o600);
    try {
      writeSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
    if (sha256(readFileSync(copy)) !== expected) throw new Error("copy differs");
    return { copyDir, copy };
  } catch (error) {
    rmSync(copyDir, { recursive: true, force: true });
    throw error;
  }
}

export function runImport({ dir, manifest, tenantId, slug }, { remote, log = console }) {
  const refuse = (why) => (log.error(`[import] REFUSED: ${why}`), 1);
  if (!UUID.test(tenantId) || !SLUG.test(slug)) return refuse("bad tenant id or slug.");
  let plan;
  try {
    plan = loadPlanState(dir, manifest, tenantId);
  } catch {
    return refuse("the import plan is missing or stale; run pilot:import:plan again.");
  }
  let verdict;
  try {
    verdict = targetVerdict(remote, plan.tables, { tenantId, slug });
  } catch {
    return refuse("the target could not be read.");
  }
  if (!verdict.ok) return refuse(`target preflight failed (${verdict.failures.join(", ")}).`);
  let copyDir;
  try {
    const bytes = readFileSync(plan.path);
    if (sha256(bytes) !== plan.sha256) return refuse("the plan file changed after it was checked.");
    const made = privateCopy(dir, bytes, plan.sha256);
    copyDir = made.copyDir;
    remote.file(made.copy);
  } catch {
    log.error("[import] FAILED: the import may be partly applied (no details are shown on purpose). Run prod:undo-data, then try again.");
    return 1;
  } finally {
    if (copyDir) rmSync(copyDir, { recursive: true, force: true });
  }
  log.log("[import] import.sql executed. Next step: prod:validate.");
  return 0;
}
