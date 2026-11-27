// prod:provision, the run step. Order matters: the target must be free (reads), then the private hand-over file, the QR
// upload and only then the tenant rows, one INSERT per statement through `remote.insert`, then a read-back that must match
// exactly. The tenant id and the typed slug come from the wrapper; the rest comes from the validated tenant.json. `remote`
// is injected: the wrapper builds it behind the production guard and with only the methods this command declared.
// Output has the tenant id, the slug and the hand-over PATH, never the token, the address, the owner email or the config.
// No dependencies beyond TS files Node loads by type stripping (no runtime imports in them).
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { provisionTenantStatements } from "../../../src/worker/tenancy/provision-sql.ts";
import { assetKey, tenantPrefix } from "../../../src/worker/storage/keys.ts";
import { literal } from "../import/sql-literal.mjs";
import { readManifest, writeManifest } from "../private-workdir.mjs";
import { mintToken, writeHandover } from "./inbound-token.mjs";
import { readQr, stageQr } from "./qr.mjs";
import { loadTenantInput } from "./tenant-input.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The validated tenant.json and QR of a workdir. Throws a generic error (before anything is written) when either is invalid. */
export function prepareProvision(dir) {
  const input = loadTenantInput(dir);
  return { input, qr: readQr(input.qrPath) };
}

/** One statement with its ?n placeholders replaced by literals (strict renderer), whitespace collapsed, ready for `remote.insert`. */
const render = ({ sql, params }) => `${sql.replace(/\s+/g, " ").replace(/\?(\d+)/g, (_, n) => literal(params[Number(n) - 1]))};`;

export function runProvision({ dir, manifest, tenantId, slug, prepared }, { remote, log = console, target, now = () => new Date().toISOString(), random, uuid = randomUUID }) {
  const refuse = (why) => (log.error(`[provision] REFUSED: ${why}`), 1);
  if (manifest.tenant !== undefined) return refuse("this workdir already has a provisioned tenant.");
  if (!UUID.test(tenantId) || prepared?.input?.slug !== slug) return refuse("bad tenant id or slug.");
  const { input, qr } = prepared;
  const hostname = `${slug}.${target.vars.ROOT_DOMAIN}`.toLowerCase();
  try {
    const rows = remote.select(`SELECT (SELECT COUNT(*) FROM tenants WHERE id = ${literal(tenantId)} OR slug = ${literal(slug)}) AS tenants, (SELECT COUNT(*) FROM tenant_domains WHERE hostname = ${literal(hostname)}) AS domains;`);
    if (rows.length !== 1 || rows[0].tenants !== 0 || rows[0].domains !== 0) return refuse("the slug, hostname or tenant id is already taken, or the target is unreadable.");
  } catch {
    return refuse("the target could not be read.");
  }
  let stage;
  let handover;
  try {
    const { hash, address } = mintToken(target.vars.INBOUND_DOMAIN, random);
    handover = writeHandover(dir, address);
    stage = stageQr(dir, qr.bytes, qr.ext);
    remote.put({ tenantId, ext: qr.ext, contentType: qr.contentType, file: stage.file });
    const row = { id: tenantId, slug, hostname, configJson: JSON.stringify(input.config), ownerEmail: input.ownerEmail, ownerId: uuid(), nowIso: now(), source: "pilot_import", qrKey: tenantPrefix(tenantId) + assetKey(`deuna-qr.${qr.ext}`), inboundTokenHash: hash };
    for (const statement of provisionTenantStatements(row)) remote.insert(render(statement));
    const back = remote.select(`SELECT slug, source, r2_prefix, qr_key, inbound_token_hash, (SELECT COUNT(*) FROM tenant_domains WHERE tenant_id = ${literal(tenantId)} AND hostname = ${literal(hostname)}) AS domains, (SELECT COUNT(*) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${literal(tenantId)} AND m.role = 'owner' AND u.email = ${literal(input.ownerEmail)} AND u.kind = 'person') AS owners FROM tenants WHERE id = ${literal(tenantId)};`);
    const ok = back.length === 1 && back[0].slug === slug && back[0].source === "pilot_import" && back[0].r2_prefix === tenantPrefix(tenantId) && back[0].qr_key === row.qrKey && back[0].inbound_token_hash === hash && back[0].domains === 1 && back[0].owners === 1;
    if (!ok) throw new Error("read-back mismatch");
  } catch {
    log.error(`[provision] FAILED: the tenant may be partly provisioned (no details are shown on purpose). tenant=${tenantId}. Follow the runbook before trying again.`);
    return 1;
  } finally {
    if (stage) rmSync(stage.copyDir, { recursive: true, force: true });
  }
  writeManifest(dir, { ...readManifest(dir), tenant: { id: tenantId, slug } });
  log.log(`[provision] tenant=${tenantId} slug=${slug} provisioned. The inbound address is in ${handover} (mode 0600). Next: pilot:import:plan <workdir>.`);
  return 0;
}
