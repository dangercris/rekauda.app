// Pure builder of the sandbox seed SQL: one fictional `cloud` tenant per sandbox Worker. No I/O, no dependencies.
// Every value is invented (fictional school, bank and zero-filled account numbers). No users, sessions or secrets.
// Idempotent: each INSERT ends with ON CONFLICT DO NOTHING and ids derive from the worker name.
import { createHash } from "node:crypto";
import { SANDBOX_NAME_PREFIX } from "./cloud-guard-core.mjs";

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TONES = ["#C81E3A", "#1E3AC8", "#1E8A3A", "#8A1E8A"];
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** Stable UUID-shaped id from the worker name (version 4 and variant bits set so it looks like any other tenant id). */
function tenantId(worker) {
  const hex = createHash("sha256").update(`rekauda-sandbox-tenant:${worker}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function configJson(index) {
  const letter = String.fromCharCode(65 + index);
  return JSON.stringify({
    schoolName: `Colegio Demo ${letter}`,
    className: `Curso Demo ${letter}`,
    classShortName: `Demo ${letter}`,
    classMark: `D${letter}`,
    treasury: { bank: `Banco Demo ${letter}`, accountType: "Ahorros", accountNumber: "0000000000", holder: `Tesorero ${letter}`, holderId: "0000000000", deunaUrl: null, qrUrl: null, helpUrl: null },
    banks: [`Banco Demo ${letter}`, "Otro banco"],
    earliestTransferDate: "2026-11-01",
    defaultTone: TONES[index % TONES.length],
    analytics: { gaMeasurementId: null },
  });
}

/** workers: list of Worker names (= tenant slugs). rootDomain must be <account-subdomain>.workers.dev. now: ISO timestamp. */
export function buildSandboxSeedSql({ workers, rootDomain, now }) {
  if (!Array.isArray(workers) || workers.length === 0 || workers.length > 26) throw new Error("workers must be a list of 1 to 26 names");
  if (new Set(workers).size !== workers.length) throw new Error("workers must not repeat a name");
  for (const worker of workers) {
    if (typeof worker !== "string" || worker.length < 3 || worker.length > 40 || !SLUG.test(worker) || worker.includes("--") || !worker.startsWith(SANDBOX_NAME_PREFIX)) throw new Error("a worker name is not a valid tenant slug starting with the sandbox prefix");
  }
  if (typeof rootDomain !== "string" || !/^[a-z0-9-]+\.workers\.dev$/.test(rootDomain)) throw new Error("rootDomain must be <account-subdomain>.workers.dev");
  if (typeof now !== "string" || Number.isNaN(Date.parse(now))) throw new Error("now must be an ISO timestamp");

  const tenants = workers.map((worker, index) => {
    const id = tenantId(worker);
    return `  (${sql(id)}, ${sql(worker)}, 'active', ${sql(configJson(index))}, ${sql(`t/${id}/`)}, NULL, 'cloud', ${sql(now)}, ${sql(now)})`;
  });
  const domains = workers.map((worker) => `  (${sql(`${worker}.${rootDomain}`)}, ${sql(tenantId(worker))}, 'subdomain', ${sql(now)})`);
  return [
    "-- Sandbox seed: fictional tenants, one per sandbox Worker. Safe to run repeatedly.",
    "INSERT INTO tenants (id, slug, status, config_json, r2_prefix, inbound_token_hash, source, created_at, updated_at) VALUES",
    `${tenants.join(",\n")} ON CONFLICT DO NOTHING;`,
    "",
    "INSERT INTO tenant_domains (hostname, tenant_id, kind, created_at) VALUES",
    `${domains.join(",\n")} ON CONFLICT DO NOTHING;`,
    "",
  ].join("\n");
}
