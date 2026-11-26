// Pure core of the pilot safety guard. No I/O, no dependencies: the loader (cloud-guard-io.mjs) reads the files.
// This tracked file holds NO pilot identifiers. The pilot's names, ids and domains come only from the local,
// gitignored wrangler.jsonc and the optional gitignored .pilot-resources.json, and are never printed.
// Values that also appear in the pilot example file are placeholders, not pilot data.

const REQUIRED_MIGRATIONS_DIR = "migrations-cloud";
const MODES = ["local", "remote"];

const asArray = (value) => (Array.isArray(value) ? value : []);
const norm = (value) => String(value).trim().toLowerCase();
const isPlaceholder = (value) => /^[0-]*$/.test(norm(value)) || /^<.*>$/.test(norm(value));
const normalizeDir = (dir) => norm(dir ?? "").replace(/^\.\//, "").replace(/\/+$/, "");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Hostname of a route pattern: no scheme, path, port or trailing dot, lowercase. */
const routeHost = (pattern) =>
  pattern.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0].toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

/** Routes of a config as { host, zone } entries; `malformed` is true when any entry cannot be understood. */
function parseRoutes(config) {
  const raw = [];
  let malformed = false;
  if ("routes" in config) {
    if (Array.isArray(config.routes)) raw.push(...config.routes);
    else malformed = true;
  }
  if ("route" in config) raw.push(config.route);
  const entries = [];
  for (const item of raw) {
    const pattern = typeof item === "string" ? item : isObject(item) ? item.pattern : undefined;
    const zone = isObject(item) ? item.zone_name : undefined;
    if (typeof pattern !== "string" || pattern.trim() === "" || (zone !== undefined && typeof zone !== "string")) malformed = true;
    else entries.push({ host: routeHost(pattern.trim()), zone: zone === undefined ? undefined : norm(zone) });
  }
  return { entries, malformed };
}

/** Names/ids and domains a wrangler config declares. */
function extractResources(config) {
  const c = isObject(config) ? config : {};
  const values = [c.name, c.account_id];
  for (const db of asArray(c.d1_databases)) values.push(db?.database_name, db?.database_id);
  for (const bucket of asArray(c.r2_buckets)) values.push(bucket?.bucket_name);
  for (const kv of asArray(c.kv_namespaces)) values.push(kv?.id);
  for (const svc of asArray(c.services)) values.push(svc?.service);
  for (const limiter of asArray(c.ratelimits)) values.push(limiter?.namespace_id);
  for (const q of [...asArray(c.queues?.producers), ...asArray(c.queues?.consumers)]) values.push(q?.queue);
  const domains = [];
  for (const { host, zone } of parseRoutes(c).entries) domains.push(host, zone);
  return {
    values: values.filter((v) => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "").map(norm),
    domains: domains.filter(Boolean).map((d) => d.replace(/^\*\.?/, "")),
  };
}

/** Real pilot data: local reference plus denylist file, minus anything that is a placeholder or an example value. */
function knownPilot(pilot, example, extra) {
  const fromPilot = extractResources(pilot);
  const fromExample = extractResources(example);
  const ex = isObject(extra) ? extra : {};
  const list = (key) => asArray(ex[key]).filter((v) => typeof v === "string" || typeof v === "number").map(norm);
  const real = (values, exampleValues) => new Set(values.filter((v) => v !== "" && !isPlaceholder(v) && !exampleValues.includes(v)));
  return {
    values: real([...fromPilot.values, ...list("names"), ...list("ids")], fromExample.values),
    domains: real([...fromPilot.domains, ...list("domains")], fromExample.domains),
  };
}

const fieldPath = (path) => path.filter((key) => typeof key === "string").join(".");

/** Walks the whole target: flags values equal to pilot data, `remote: true` and numeric namespace ids. */
function deepScan(node, path, known, violations) {
  if (typeof node === "string") {
    if (known.values.has(norm(node))) violations.push({ field: fieldPath(path), reason: "value matches a pilot resource" });
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => deepScan(item, [...path, index], known, violations));
  } else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "remote" && value === true) violations.push({ field: "remote", reason: "remote bindings are not allowed in phase 1" });
      else if (key === "namespace_id" && typeof value === "number" && known.values.has(norm(value))) violations.push({ field: fieldPath([...path, key]), reason: "value matches a pilot resource" });
      else deepScan(value, [...path, key], known, violations);
    }
  }
}

function checkRoutes(target, known, violations) {
  const sandbox = target.vars?.SANDBOX === "true";
  const { entries, malformed } = parseRoutes(target);
  if (malformed) violations.push({ field: "routes", reason: "routes are malformed: refusing to guess" });
  for (const { host, zone } of entries) {
    if (host.includes("*") && !(host.startsWith("*") && host.indexOf("*", 1) === -1)) violations.push({ field: "routes", reason: "a * is only allowed as the leading label" });
    for (const domain of known.domains) {
      const coversApex = host === domain || (host.startsWith("*") && domain.endsWith(host.slice(1)));
      const isWildcard = host === `*.${domain}`;
      if (coversApex) violations.push({ field: "routes", reason: "route covers the pilot domain" });
      else if (isWildcard && !sandbox) violations.push({ field: "routes", reason: "wildcard on the pilot domain needs vars.SANDBOX=true" });
      else if (!isWildcard && host.endsWith(`.${domain}`)) violations.push({ field: "routes", reason: "route inside the pilot domain" });
      if (zone && !sandbox && (zone === domain || zone.endsWith(`.${domain}`) || domain.endsWith(`.${zone}`))) violations.push({ field: "routes", reason: "zone_name covers the pilot domain" });
    }
  }
}

function checkDatabases(target, violations) {
  const databases = asArray(target.d1_databases);
  if (databases.length === 0) violations.push({ field: "d1_databases.migrations_dir", reason: `no D1 database: migrations_dir must be ${REQUIRED_MIGRATIONS_DIR}` });
  for (const db of databases) {
    if (normalizeDir(db?.migrations_dir) !== REQUIRED_MIGRATIONS_DIR) violations.push({ field: "d1_databases.migrations_dir", reason: `must be ${REQUIRED_MIGRATIONS_DIR}` });
  }
}

function checkRemote(target, hasPilot, violations) {
  violations.push({ field: "mode", reason: "remote is disabled in phase 1 (local D1 only)" });
  if (asArray(target.d1_databases).some((db) => typeof db?.database_id !== "string" || isPlaceholder(db.database_id))) violations.push({ field: "d1_databases.database_id", reason: "placeholder id: not allowed for remote" });
  if (!hasPilot) violations.push({ field: "pilot", reason: "no real pilot data known: cannot prove the target is distinct" });
}

/** Returns { ok, violations: [{ field, reason }], warnings }. Output never contains ids, names or secrets. */
export function checkCloudConfig({ target, pilot, pilotExample, mode, extraDenylist }) {
  if (!MODES.includes(mode)) return { ok: false, violations: [{ field: "mode", reason: `unknown mode, expected one of ${MODES.join(", ")}` }], warnings: [] };
  if (!isObject(target)) return { ok: false, violations: [{ field: "config", reason: "cloud config missing or not an object" }], warnings: [] };

  const known = knownPilot(pilot, pilotExample, extraDenylist);
  const hasPilot = known.values.size > 0 || known.domains.size > 0;
  const violations = [];
  const warnings = [];
  if (!hasPilot && mode === "local") warnings.push("no real pilot data known (wrangler.jsonc has only placeholders and .pilot-resources.json is absent): pilot name and id checks could not run");

  deepScan(target, [], known, violations);
  if (target.env !== undefined && !(isObject(target.env) && Object.keys(target.env).length === 0)) violations.push({ field: "env", reason: "env sections are not allowed in phase 1" });
  checkDatabases(target, violations);
  checkRoutes(target, known, violations);
  if (mode === "remote") checkRemote(target, hasPilot, violations);
  return { ok: violations.length === 0, violations, warnings };
}
