// prod:provision, the run step. Order matters: an exclusive lock file, the manifest check, reads (slug, hostname and id free; owner
// account state), the manifest marked `provisioning` (atomic) BEFORE the first remote write, the QR upload, the tenant rows one INSERT
// at a time, a read-back that must match exactly (config included), and only then the private hand-over file and the manifest marked
// `provisioned`. A failure leaves the state `provisioning`: the run refuses to start again and points at prod:undo-tenant.
// The tenant id, the owner id and the typed slug come from the wrapper; the rest comes from the validated tenant.json. `remote` is
// injected: the wrapper builds it behind the production guard and with only the methods this command declared.
// Output has the tenant id, the slug and the hand-over PATH, never the token, the address, the owner email or the config.
// No dependencies beyond TS files Node loads by type stripping (no runtime imports in them).
import { closeSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { provisionTenantStatements } from "../../../src/worker/tenancy/provision-sql.ts";
import { assetKey, tenantPrefix } from "../../../src/worker/storage/keys.ts";
import { literal } from "../import/sql-literal.mjs";
import { readManifest, writeManifest } from "../private-workdir.mjs";
import { mintToken, writeHandover } from "./inbound-token.mjs";
import { readQr, stageQr } from "./qr.mjs";
import { loadTenantInput } from "./tenant-input.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAIN_ID = /^[A-Za-z0-9._-]{1,64}$/;
export const LOCK_FILE = "provision.lock";

/** The validated tenant.json and QR of a workdir. Throws a generic error (before anything is written) when either is invalid. */
export function prepareProvision(dir) {
  const input = loadTenantInput(dir);
  return { input, qr: readQr(input.qrPath) };
}

/** One statement with its ?n placeholders replaced by literals (strict renderer), whitespace collapsed, ready for `remote.insert`. */
export const render = ({ sql, params }) => `${sql.replace(/\s+/g, " ").replace(/\?(\d+)/g, (_, n) => literal(params[Number(n) - 1]))};`;

/** The owner email in Cloud now: `state` is "none", "person" (an existing account would become owner) or "synthetic" (refused); `id` is the person's user id. Throws when unreadable. */
export function readOwner(remote, email) {
  const rows = remote.select(`SELECT id, kind FROM users WHERE email = ${literal(email)};`);
  if (rows.length === 0) return { state: "none" };
  if (rows.length === 1 && (rows[0].kind === "person" || rows[0].kind === "synthetic") && typeof rows[0].id === "string" && PLAIN_ID.test(rows[0].id)) return { state: rows[0].kind, id: rows[0].id };
  throw new Error("unreadable");
}

/** What the owner email is in Cloud now: "none", "person" or "synthetic". Throws when unreadable. */
export const readOwnerState = (remote, email) => readOwner(remote, email).state;

export function runProvision({ dir, tenantId, ownerId, slug, prepared, reuseOwner = false }, { remote, log = console, target, now = () => new Date().toISOString(), random }) {
  const refuse = (why) => (log.error(`[provision] REFUSED: ${why}`), 1);
  if (!UUID.test(tenantId) || !UUID.test(ownerId) || prepared?.input?.slug !== slug) return refuse("bad tenant id or slug.");
  const lockPath = join(dir, LOCK_FILE);
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    return refuse(`another run holds ${LOCK_FILE} in the workdir, or a crashed run left it. Check, then remove the file by hand.`);
  }
  try {
    return provision({ dir, tenantId, ownerId, slug, prepared, reuseOwner }, { remote, log, target, now, random, refuse });
  } finally {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}

function provision({ dir, tenantId, ownerId, slug, prepared, reuseOwner }, { remote, log, target, now, random, refuse }) {
  const { input, qr } = prepared;
  const current = readManifest(dir).tenant;
  if (current !== undefined) return refuse(current.state === "provisioning" ? `a previous provisioning did not finish (tenant=${current.id}). Run prod:undo-tenant for it (it must have no data), then try again.` : "this workdir already has a provisioned tenant.");
  const hostname = `${slug}.${target.vars.ROOT_DOMAIN}`.toLowerCase();
  // The id of an existing account that becomes the owner. prod:undo-tenant must never delete it, so it is recorded with the tenant.
  let reusedOwnerId;
  try {
    const rows = remote.select(`SELECT (SELECT COUNT(*) FROM tenants WHERE id = ${literal(tenantId)} OR slug = ${literal(slug)}) AS tenants, (SELECT COUNT(*) FROM tenant_domains WHERE hostname = ${literal(hostname)}) AS domains;`);
    if (rows.length !== 1 || rows[0].tenants !== 0 || rows[0].domains !== 0) return refuse("the slug, hostname or tenant id is already taken, or the target is unreadable.");
    const owner = readOwner(remote, input.ownerEmail);
    if (owner.state === "synthetic") return refuse("the owner email belongs to a system account.");
    if ((owner.state === "person") !== reuseOwner) return refuse("the owner email state changed or does not match the typed phrase.");
    if (reuseOwner) reusedOwnerId = owner.id;
  } catch {
    return refuse("the target could not be read.");
  }
  let stage;
  try {
    writeManifest(dir, { ...readManifest(dir), tenant: { id: tenantId, slug, state: "provisioning", ...(reusedOwnerId === undefined ? {} : { reusedOwnerId }) } });
    const { hash, address } = mintToken(target.vars.INBOUND_DOMAIN, random);
    stage = stageQr(dir, qr.bytes, qr.ext);
    remote.put({ tenantId, ext: qr.ext, contentType: qr.contentType, file: stage.file });
    const configJson = JSON.stringify(input.config);
    const row = { id: tenantId, slug, hostname, configJson, ownerEmail: input.ownerEmail, ownerId, nowIso: now(), source: "pilot_import", qrKey: tenantPrefix(tenantId) + assetKey(`deuna-qr.${qr.ext}`), inboundTokenHash: hash };
    for (const statement of provisionTenantStatements(row)) remote.insert(render(statement));
    const back = remote.select(`SELECT slug, source, r2_prefix, qr_key, inbound_token_hash, config_json, (SELECT COUNT(*) FROM tenant_domains WHERE tenant_id = ${literal(tenantId)} AND hostname = ${literal(hostname)}) AS domains, (SELECT COUNT(*) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${literal(tenantId)} AND m.role = 'owner' AND u.email = ${literal(input.ownerEmail)} AND u.kind = 'person') AS owners, (SELECT u.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${literal(tenantId)} AND m.role = 'owner' AND u.email = ${literal(input.ownerEmail)} AND u.kind = 'person') AS owner_id FROM tenants WHERE id = ${literal(tenantId)};`);
    const ok = back.length === 1 && back[0].slug === slug && back[0].source === "pilot_import" && back[0].r2_prefix === tenantPrefix(tenantId) && back[0].qr_key === row.qrKey && back[0].inbound_token_hash === hash && back[0].config_json === configJson && back[0].domains === 1 && back[0].owners === 1;
    // The owner INSERT is ON CONFLICT DO NOTHING: an account registered with this email after the read is silently the owner. Record it so undo keeps it.
    const expectedOwner = reusedOwnerId ?? ownerId;
    if (ok && back[0].owner_id !== expectedOwner && !reuseOwner && typeof back[0].owner_id === "string" && PLAIN_ID.test(back[0].owner_id)) {
      writeManifest(dir, { ...readManifest(dir), tenant: { id: tenantId, slug, state: "provisioning", reusedOwnerId: back[0].owner_id } });
      log.error(`[provision] REFUSED: an account was registered with the owner email while provisioning, so it became the owner. It is recorded as tenant.reusedOwnerId and undo keeps it. tenant=${tenantId}. Run prod:undo-tenant for it, then start again.`);
      return 1;
    }
    if (!ok || back[0].owner_id !== expectedOwner) throw new Error("read-back mismatch");
    // The address is handed over only now: a failed run never leaves a dead inbound address behind.
    const handover = writeHandover(dir, address);
    writeManifest(dir, { ...readManifest(dir), tenant: { id: tenantId, slug, state: "provisioned", ...(reusedOwnerId === undefined ? {} : { reusedOwnerId }) } });
    log.log(`[provision] tenant=${tenantId} slug=${slug} provisioned${reusedOwnerId === undefined ? "" : ` reusedOwnerId=${reusedOwnerId}`}. The inbound address is in ${handover} (mode 0600). Next: pilot:import:plan <workdir>.`);
    return 0;
  } catch {
    log.error(`[provision] FAILED: the tenant may be partly provisioned (no details are shown on purpose). tenant=${tenantId}. If it has no data, run prod:undo-tenant for it, then follow the runbook before trying again.`);
    return 1;
  } finally {
    if (stage) rmSync(stage.copyDir, { recursive: true, force: true });
  }
}
