// Test world for the import tools: a throwaway checkout, a private workdir holding two matching invented exports and
// (optionally) the generated plan, and an in-memory Cloud database with the real baseline schema and the target tenant.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import { createCloudTestDb } from "../../../src/worker/test/d1-cloud";
import { fakeCheckout } from "../fake-checkout";
import { TENANT_ID, makeTables } from "./pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { canonicalHash } from "../pilot-export.mjs";
// @ts-expect-error plain .mjs module without types
import { createWorkdir, readManifest, writeManifest } from "../private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { runImportPlan } from "./plan.mjs";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

export const SLUG = "curso-demo";
export const OTHER = "d0000000-0000-4000-8000-0000000000d1";
export const NOW = "2026-11-27T00:00:00Z";

export function makePilotWorld({ plan = true, provisioned = true, tenant = { slug: SLUG, source: "pilot_import" } as { slug: string; source: string } | null, extraFiles = {} as Record<string, string> } = {}) {
  const root = fakeCheckout("import-world", extraFiles);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "import-world-tmp-")));
  dirs.push(root, tmp);
  const dir = createWorkdir({ root: root + "/", tmp });
  const manifest = readManifest(dir);
  for (const n of [1, 2]) {
    const tables = makeTables();
    writeFileSync(join(dir, `export-${n}.json`), JSON.stringify({ version: 1, tables }), { mode: 0o600 });
    const hash = canonicalHash(tables);
    manifest.exports.push({ file: `export-${n}.json`, hash, counts: {}, at: NOW, matchesFirst: n === 1 ? null : hash === manifest.exports[0].hash });
  }
  // prod:provision records the tenant in the manifest; a world for provisioning tests starts without it.
  if (provisioned) manifest.tenant = { id: TENANT_ID, slug: SLUG, state: "provisioned" };
  writeManifest(dir, manifest);
  const quiet = { error: () => undefined, warn: () => undefined, log: () => undefined };
  if (plan) expect(runImportPlan([dir, TENANT_ID], { root: root + "/", log: quiet, tmp })).toBe(0);
  const cloud = createCloudTestDb();
  const addTenant = (id: string, slug: string, source: string) => cloud.sqlite.exec(`INSERT INTO tenants (id, slug, config_json, r2_prefix, source, created_at, updated_at) VALUES ('${id}', '${slug}', '{}', 't/${id}/', '${source}', '${NOW}', '${NOW}')`);
  if (tenant) addTenant(TENANT_ID, tenant.slug, tenant.source);
  const count = (table: string) => (cloud.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  /** A collection row for any tenant, to build collisions and "second tenant" situations. */
  const addCollection = (tenantId: string, id: string, slug: string) => cloud.sqlite.exec(`INSERT INTO collections (tenant_id, id, slug, title, description, notes_json, options_json, deadline, status, max_per_payment, tone, created_at, updated_at) VALUES ('${tenantId}', '${id}', '${slug}', 'T', 'D', '[]', '[]', '2026-12-01', 'abierta', 1, '#000000', '${NOW}', '${NOW}')`);
  return { dir, root, tmp, cloud, addTenant, addCollection, count };
}
