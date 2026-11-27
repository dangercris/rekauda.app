// prod:import, the apply step. Order matters and nothing is skipped: the plan must be in force (loadPlanState), the target
// preflight runs with REAL reads right now (tenant source pilot_import, zero rows, no id collision), the SQL file is hashed
// once more, and only then the file produced by pilot:import:plan is executed, whole. `remote` is injected: the wrapper
// builds it behind the production guard. Output has counts and check names only, never rows. No dependencies.
import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadPlanState } from "./plan.mjs";
import { SLUG, UUID, targetVerdict } from "./target.mjs";

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
  try {
    if (hash("sha256", readFileSync(plan.path, "utf8"), "hex") !== plan.sha256) return refuse("the plan file changed after it was checked.");
    remote.file(plan.path);
  } catch {
    log.error("[import] FAILED: the import may be partly applied (no details are shown on purpose). Run prod:undo-data, then try again.");
    return 1;
  }
  log.log("[import] import.sql executed. Next step: prod:validate.");
  return 0;
}
