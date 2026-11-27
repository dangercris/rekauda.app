// Pure core of the pilot safety guard. No I/O, no dependencies: the loader (cloud-guard-io.mjs) reads the files.
// This tracked file holds NO pilot identifiers. The pilot's names, ids and domains come only from the local,
// gitignored wrangler.jsonc and the optional gitignored .pilot-resources.json, and are never printed.
// Values that also appear in the pilot example file are placeholders, not pilot data.

const REQUIRED_MIGRATIONS_DIR = "migrations-cloud";
const MODES = ["local", "remote"];

const asArray = (value) => (Array.isArray(value) ? value : []);
// NFKC first: full-width and other compatibility spellings of a name compare equal to the plain one.
const norm = (value) => String(value).normalize("NFKC").trim().toLowerCase();
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

/**
 * Walks the whole target: flags values equal to pilot data, `remote: true` and numeric namespace ids.
 * `skipTopLevel` names top-level keys that are not scanned (sandbox mode: account_id only).
 */
function deepScan(node, path, known, violations, skipTopLevel = []) {
  if (typeof node === "string") {
    if (known.values.has(norm(node))) violations.push({ field: fieldPath(path), reason: "value matches a pilot resource" });
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => deepScan(item, [...path, index], known, violations));
  } else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (path.length === 0 && skipTopLevel.includes(key)) continue;
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

const SANDBOX_CONFIG_FILE = "wrangler.sandbox.jsonc";
export const SANDBOX_NAME_PREFIX = "rekauda-sandbox-";
const SANDBOX_MAIN = "src/worker/index.ts";
const SANDBOX_ROOT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/;
const WORKER_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PILOT_FILE_KEYS = ["names", "ids", "domains", "workers", "d1Ids", "buckets", "ratelimitIds", "productionRoot"];

/** Top-level keys a sandbox config may have. Everything else (services, queues, routes, env, triggers, build...) is refused. */
const SANDBOX_TOP_KEYS = ["$schema", "name", "main", "compatibility_date", "compatibility_flags", "workers_dev", "preview_urls", "account_id", "assets", "images", "rules", "d1_databases", "r2_buckets", "ratelimits", "vars", "observability"];
const SANDBOX_ENTRY_KEYS = {
  assets: ["directory", "binding", "html_handling", "not_found_handling", "run_worker_first"],
  images: ["binding"],
  observability: ["enabled"],
};
const SANDBOX_LIST_KEYS = {
  d1_databases: ["binding", "database_name", "database_id", "migrations_dir"],
  r2_buckets: ["binding", "bucket_name"],
  ratelimits: ["name", "namespace_id", "simple"],
};

const isPrefixedName = (value, prefix) => typeof value === "string" && value.startsWith(prefix) && value.length >= 3 && value.length <= 40 && WORKER_SLUG.test(value) && !value.includes("--") && !value.endsWith("-");
const isSandboxName = (value) => isPrefixedName(value, SANDBOX_NAME_PREFIX);

/** 32 hex digits (UUID without hyphens or braces, account id), else null. */
const hexForm = (value) => {
  const bare = norm(value).replace(/^[{(]/, "").replace(/[})]$/, "").replaceAll("-", "");
  return /^[0-9a-f]{32}$/.test(bare) ? bare : null;
};

/** Pilot knowledge for sandbox mode: everything to compare against, and the categories that must be known. */
function sandboxPilot(pilot, pilotExample, extra, withRatelimits = false) {
  const problems = [];
  let ex = {};
  if (extra !== null && extra !== undefined) {
    if (!isObject(extra)) problems.push("the pilot reference file is not an object");
    else {
      ex = extra;
      for (const [key, value] of Object.entries(extra)) {
        if (!PILOT_FILE_KEYS.includes(key)) problems.push("the pilot reference file has an unknown key");
        else if (key === "productionRoot") {
          if (typeof value !== "string") problems.push("the pilot reference file has a malformed productionRoot");
        } else if (!Array.isArray(value) || value.some((v) => typeof v !== "string" && typeof v !== "number")) problems.push("the pilot reference file has a malformed list");
      }
    }
  }
  const list = (key) => (key !== "productionRoot" && Array.isArray(ex[key]) ? ex[key].filter((v) => typeof v === "string" || typeof v === "number").map(norm) : []);
  const p = isObject(pilot) ? pilot : {};
  const example = extractResources(pilotExample);
  const realName = (v) => typeof v === "string" && norm(v) !== "" && !isPlaceholder(v) && !example.values.includes(norm(v));
  const realId = (v) => typeof v === "string" && UUID.test(norm(v)) && !isPlaceholder(v);
  const names = (values) => new Set(values.filter(realName).map(norm));
  const ids = (values) => new Set(values.filter(realId).map(norm));
  const categories = {
    "worker name": names([p.name, ...list("workers")]),
    "D1 id": ids([...asArray(p.d1_databases).map((db) => db?.database_id), ...list("d1Ids"), ...list("ids")]),
    "R2 bucket": names([...asArray(p.r2_buckets).map((b) => b?.bucket_name), ...list("buckets")]),
  };
  if (withRatelimits) {
    const limiterIds = [...asArray(p.ratelimits).map((r) => r?.namespace_id), ...list("ratelimitIds")];
    categories["ratelimit id"] = new Set(limiterIds.filter((v) => (typeof v === "string" || typeof v === "number") && !isPlaceholder(v) && norm(v) !== "").map(norm));
  }
  // Comparison set: every non-placeholder pilot value, example-equal ones included (an id never gets exempted for matching an example).
  const everything = [...extractResources(p).values, ...list("names"), ...list("ids"), ...list("workers"), ...list("d1Ids"), ...list("buckets"), ...list("ratelimitIds"), ...Object.values(categories).flatMap((c) => [...c])];
  const values = new Set(everything.map(norm).filter((v) => v !== "" && !isPlaceholder(v)));
  const hex = new Set([...values].map(hexForm).filter(Boolean));
  const has = (value) => values.has(value) || ((hexForm(value) ?? "") !== "" && hex.has(hexForm(value)));
  const missing = Object.entries(categories).filter(([, set]) => set.size === 0).map(([label]) => label);
  return { known: { values: { has }, domains: new Set() }, missing, problems };
}

const PILOT_DB_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

/**
 * Read-only pilot export needs the pilot's D1 name and account id, and the same complete pilot knowledge as sandbox mode.
 * Fails closed with generic reasons (never a value). Returns { result, dbName, accountId }; both are undefined unless ok.
 */
export function checkPilotReference({ pilot, pilotExample, extraDenylist }) {
  const violations = [];
  const refuse = (field, reason) => violations.push({ field, reason });
  const { missing, problems } = sandboxPilot(pilot, pilotExample, extraDenylist);
  for (const problem of problems) refuse("pilot", problem);
  if (missing.length > 0) refuse("pilot", `pilot data incomplete, missing: ${missing.join(", ")}`);
  const p = isObject(pilot) ? pilot : {};
  const example = extractResources(pilotExample).values;
  const dbs = asArray(p.d1_databases);
  const name = dbs[0]?.database_name;
  if (dbs.length !== 1 || !isObject(dbs[0])) refuse("pilot", "the pilot reference must name exactly one D1 database");
  else if (typeof name !== "string" || !PILOT_DB_NAME.test(name) || isPlaceholder(name) || example.includes(norm(name))) refuse("pilot", "the pilot D1 database name is missing or malformed");
  const account = p.account_id;
  if (typeof account !== "string" || !/^[0-9a-f]{32}$|^[a-z0-9][a-z0-9_-]{3,63}$/i.test(account) || isPlaceholder(account)) refuse("pilot", "the pilot account id is missing or malformed");
  const ok = violations.length === 0;
  return { result: { ok, violations, warnings: [] }, dbName: ok ? name : undefined, accountId: ok ? account : undefined };
}

function checkSandboxShape(target, refuse) {
  for (const key of Object.keys(target)) if (!SANDBOX_TOP_KEYS.includes(key)) refuse(key, "key not allowed in a sandbox config");
  if (target.main !== SANDBOX_MAIN) refuse("main", `must be ${SANDBOX_MAIN}`);
  for (const [key, allowed] of Object.entries(SANDBOX_ENTRY_KEYS)) {
    if (key in target && (!isObject(target[key]) || Object.keys(target[key]).some((k) => !allowed.includes(k)))) refuse(key, "unknown or malformed settings");
  }
  for (const [key, allowed] of Object.entries(SANDBOX_LIST_KEYS)) {
    const entries = target[key];
    if (Array.isArray(entries) && entries.some((e) => !isObject(e) || Object.keys(e).some((k) => !allowed.includes(k)))) refuse(key, "unknown keys in an entry");
    if (key !== "ratelimits" && !(Array.isArray(entries) && entries.length === 1)) refuse(key, "must have exactly one entry");
  }
  if (asArray(target.d1_databases)[0]?.binding !== "DB") refuse("d1_databases.binding", 'must be "DB"');
  if (asArray(target.r2_buckets)[0]?.binding !== "RECEIPTS") refuse("r2_buckets.binding", 'must be "RECEIPTS"');
}

/**
 * Remote check for the workers.dev sandbox. Fails closed: every condition must hold. The pilot's account_id is the ONLY
 * value allowed to equal the pilot's (same Cloudflare account); every other string is scanned against pilot data, in
 * every spelling of an id. Pilot knowledge must cover a worker name, a D1 id and an R2 bucket.
 * Returns { ok, violations: [{ field, reason }], warnings }. Output never contains ids, names or secrets.
 */
export function checkSandboxConfig({ target, targetFile, pilot, pilotExample, extraDenylist }) {
  const violations = [];
  const refuse = (field, reason) => violations.push({ field, reason });
  if (targetFile !== SANDBOX_CONFIG_FILE) refuse("config", `sandbox mode only accepts ${SANDBOX_CONFIG_FILE}`);
  if (!isObject(target)) return { ok: false, violations: [...violations, { field: "config", reason: "sandbox config missing or not an object" }], warnings: [] };

  const { known, missing, problems } = sandboxPilot(pilot, pilotExample, extraDenylist);
  for (const problem of problems) refuse("pilot", problem);
  if (missing.length > 0) refuse("pilot", `pilot data incomplete, missing: ${missing.join(", ")} (see wrangler.sandbox.example.jsonc)`);

  deepScan(target, [], known, violations, ["account_id"]);
  checkSandboxShape(target, refuse);
  if (target.workers_dev !== true) refuse("workers_dev", "must be true");

  const vars = isObject(target.vars) ? target.vars : {};
  if (vars.SANDBOX !== "true") refuse("vars.SANDBOX", 'must be the string "true"');
  if (vars.TENANCY !== "multi") refuse("vars.TENANCY", 'must be "multi"');
  if (typeof vars.ROOT_DOMAIN !== "string" || !SANDBOX_ROOT.test(vars.ROOT_DOMAIN)) refuse("vars.ROOT_DOMAIN", "must be <account-subdomain>.workers.dev");

  const workers = vars.SANDBOX_WORKERS;
  if (!Array.isArray(workers) || workers.length === 0 || workers.some((w) => typeof w !== "string")) refuse("vars.SANDBOX_WORKERS", "must be a non-empty list of worker names");
  else {
    if (!workers.includes(target.name)) refuse("vars.SANDBOX_WORKERS", "must include the config name");
    if (new Set(workers).size !== workers.length) refuse("vars.SANDBOX_WORKERS", "must not repeat a name");
    if (workers.some((w) => !isSandboxName(w))) refuse("vars.SANDBOX_WORKERS", `every name must start with ${SANDBOX_NAME_PREFIX} and be a valid slug`);
  }
  if (!isSandboxName(target.name)) refuse("name", `must start with ${SANDBOX_NAME_PREFIX} and be a valid slug`);

  checkDatabases(target, violations);
  const databases = asArray(target.d1_databases);
  if (databases.some((db) => typeof db?.database_name !== "string" || !db.database_name.startsWith(SANDBOX_NAME_PREFIX))) refuse("d1_databases.database_name", `must start with ${SANDBOX_NAME_PREFIX}`);
  if (databases.some((db) => typeof db?.database_id !== "string" || isPlaceholder(db.database_id))) refuse("d1_databases.database_id", "placeholder id: not allowed for remote");
  if (asArray(target.r2_buckets).some((b) => typeof b?.bucket_name !== "string" || !b.bucket_name.startsWith(SANDBOX_NAME_PREFIX))) refuse("r2_buckets.bucket_name", `must start with ${SANDBOX_NAME_PREFIX}`);
  return { ok: violations.length === 0, violations, warnings: [] };
}

const PRODUCTION_CONFIG_FILE = "wrangler.production.jsonc";
export const PRODUCTION_NAME_PREFIX = "rekauda-cloud-";
const PRODUCTION_TOP_KEYS = [...SANDBOX_TOP_KEYS, "routes", "send_email", "triggers"];
const PRODUCTION_VARS = ["TENANCY", "ROOT_DOMAIN", "INBOUND_DOMAIN", "LEGACY_REDIRECTS"];
const APEX_POLICIES = ["forbid", "require", "any"];
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const normRoot = (value) => norm(value).replace(/\.$/, "");
/** Numeric spellings collide ("04242", "+4242", "4242.0" all become "4242"); anything else compares normalized. */
const canonId = (value) => {
  const text = norm(value);
  return text !== "" && Number.isFinite(Number(text)) ? String(Number(text)) : text;
};
const limiterIds = (config, extraList) => [...asArray(config?.ratelimits).map((r) => r?.namespace_id), ...asArray(extraList)].filter((v) => typeof v === "string" || typeof v === "number").map(canonId);
const isProdName = (value) => isPrefixedName(value, PRODUCTION_NAME_PREFIX);

/** Legacy map: at most 20 entries, key /r/<slug>, value https://<slug>.<root>/r/<same slug>. Same rules as the Worker's parser (S7). */
function legacyRedirectsValid(map, root) {
  if (!isObject(map) || Object.keys(map).length > 20) return false;
  return Object.entries(map).every(([key, value]) => {
    const slug = /^\/r\/([a-z0-9-]{1,48})$/.exec(key)?.[1];
    return slug !== undefined && value === `https://${slug}.${root}/r/${slug}`;
  });
}

/** Routes must be exactly the wildcard, plus one apex entry (route or custom domain) depending on the command's apex policy. */
function checkProductionRoutes(target, root, apex, refuse) {
  if ("route" in target || !Array.isArray(target.routes)) return refuse("route", "use a routes list: exactly the wildcard entry, plus the apex only in the switch step");
  const wildcard = (r) => isObject(r) && r.pattern === `*.${root}/*` && r.zone_name === root && Object.keys(r).length === 2;
  const apexEntry = (r) => isObject(r) && ((r.pattern === `${root}/*` && r.zone_name === root && Object.keys(r).length === 2) || (r.pattern === root && r.custom_domain === true && Object.keys(r).length === 2));
  const apexes = target.routes.filter(apexEntry);
  if (target.routes.filter(wildcard).length !== 1 || apexes.length > 1 || target.routes.length !== 1 + apexes.length) refuse("routes", "routes must be the *.<root>/* wildcard and at most one apex entry");
  else if (apex === "forbid" && apexes.length === 1) refuse("routes", "the apex is only allowed in the switch step (prod:switch-apex)");
  else if (apex === "require" && apexes.length === 0) refuse("routes", "the switch step needs the apex entry in the config");
}

/**
 * Remote check for the production Worker. Fails closed. Nothing may equal pilot data (worker, D1 id, R2 bucket and
 * ratelimit ids must all be known) or sandbox data; account_id is the only exemption. `apex` is the command's policy:
 * "forbid" (deploy), "require" (switch-apex) or "any" (guard, migrate, status). Output never contains ids, names or secrets.
 */
export function checkProductionConfig({ target, targetFile, pilot, pilotExample, sandbox, extraDenylist, apex }) {
  const violations = [];
  const refuse = (field, reason) => violations.push({ field, reason });
  if (targetFile !== PRODUCTION_CONFIG_FILE) refuse("config", `production mode only accepts ${PRODUCTION_CONFIG_FILE}`);
  if (!APEX_POLICIES.includes(apex)) refuse("apex", `unknown apex policy, expected one of ${APEX_POLICIES.join(", ")}`);
  if (!isObject(target)) return { ok: false, violations: [...violations, { field: "config", reason: "production config missing or not an object" }], warnings: [] };

  const { known, missing, problems } = sandboxPilot(pilot, pilotExample, extraDenylist, true);
  for (const problem of problems) refuse("pilot", problem);
  if (missing.length > 0) refuse("pilot", `pilot data incomplete, missing: ${missing.join(", ")} (see wrangler.sandbox.example.jsonc)`);
  deepScan(target, [], known, violations, ["account_id"]);

  const sandboxValues = new Set(extractResources(isObject(sandbox) ? { ...sandbox, account_id: undefined } : {}).values.filter((v) => !isPlaceholder(v)));
  const sandboxHex = new Set([...sandboxValues].map(hexForm).filter(Boolean));
  const sandboxHas = (value) => sandboxValues.has(value) || ((hexForm(value) ?? "") !== "" && sandboxHex.has(hexForm(value)));
  const sandboxScan = [];
  deepScan(target, [], { values: { has: sandboxHas } }, sandboxScan, ["account_id"]);
  for (const { field } of sandboxScan) refuse(field, "value matches a sandbox resource");

  for (const key of Object.keys(target)) if (!PRODUCTION_TOP_KEYS.includes(key)) refuse(key, "key not allowed in a production config");
  if (target.main !== SANDBOX_MAIN) refuse("main", `must be ${SANDBOX_MAIN}`);
  for (const [key, allowed] of Object.entries(SANDBOX_ENTRY_KEYS)) {
    if (key in target && (!isObject(target[key]) || Object.keys(target[key]).some((k) => !allowed.includes(k)))) refuse(key, "unknown or malformed settings");
  }
  if ("assets" in target && target.assets?.directory !== "./dist") refuse("assets.directory", 'must be "./dist"');
  if (target.workers_dev !== false) refuse("workers_dev", "must be false");
  if (target.preview_urls !== false) refuse("preview_urls", "must be false");
  if (!isProdName(target.name)) refuse("name", `must start with ${PRODUCTION_NAME_PREFIX} and be a valid slug`);

  const vars = isObject(target.vars) ? target.vars : {};
  for (const key of Object.keys(vars)) if (!PRODUCTION_VARS.includes(key)) refuse(`vars.${key}`, "var not allowed in production");
  const root = typeof vars.ROOT_DOMAIN === "string" ? vars.ROOT_DOMAIN : "";
  const extra = isObject(extraDenylist) ? extraDenylist : {};
  const pinned = typeof extra.productionRoot === "string" ? normRoot(extra.productionRoot) : "";
  if (pinned === "") refuse("pilot", "productionRoot missing from the pilot reference file (see wrangler.sandbox.example.jsonc)");
  else if (normRoot(root) !== pinned) refuse("vars.ROOT_DOMAIN", "must equal productionRoot from the pilot reference file");
  const pilotDomains = [...extractResources(isObject(pilot) ? pilot : {}).domains, ...asArray(extra.domains).filter((d) => typeof d === "string")].map(normRoot);
  if (root !== "" && normRoot(root) !== pinned && pilotDomains.includes(normRoot(root))) refuse("vars.ROOT_DOMAIN", "is a pilot domain other than productionRoot");
  if (vars.TENANCY !== "multi") refuse("vars.TENANCY", 'must be "multi"');
  if (!DNS_NAME.test(root) || root.endsWith(".workers.dev")) refuse("vars.ROOT_DOMAIN", "must be a DNS name and not workers.dev");
  if (vars.INBOUND_DOMAIN !== `in.${root}`) refuse("vars.INBOUND_DOMAIN", 'must be "in." + ROOT_DOMAIN');
  if ("LEGACY_REDIRECTS" in vars && !legacyRedirectsValid(vars.LEGACY_REDIRECTS, root)) refuse("vars.LEGACY_REDIRECTS", "invalid legacy redirect map");
  checkProductionRoutes(target, root, apex, refuse);

  for (const [key, allowed] of Object.entries({ ...SANDBOX_LIST_KEYS, send_email: ["name"] })) {
    const entries = target[key];
    if (Array.isArray(entries) && entries.some((e) => !isObject(e) || Object.keys(e).some((k) => !allowed.includes(k)))) refuse(key, "unknown keys in an entry");
  }
  const databases = asArray(target.d1_databases);
  const buckets = asArray(target.r2_buckets);
  const limiters = asArray(target.ratelimits);
  if (databases.length !== 1 || databases[0]?.binding !== "DB") refuse("d1_databases", 'must be exactly one database bound as "DB"');
  checkDatabases(target, violations);
  if (databases.some((db) => !isProdName(db?.database_name))) refuse("d1_databases.database_name", `must start with ${PRODUCTION_NAME_PREFIX}`);
  if (databases.some((db) => typeof db?.database_id !== "string" || isPlaceholder(db.database_id) || !UUID.test(norm(db.database_id)))) refuse("d1_databases.database_id", "must be a real UUID (no placeholder)");
  if (buckets.map((b) => b?.binding).sort().join() !== "MAIL_ARCHIVE,RECEIPTS") refuse("r2_buckets", "must be exactly RECEIPTS and MAIL_ARCHIVE");
  if (buckets.some((b) => !isProdName(b?.bucket_name))) refuse("r2_buckets.bucket_name", `must start with ${PRODUCTION_NAME_PREFIX}`);
  if (limiters.length !== 3) refuse("ratelimits", "must be exactly 3 ratelimits");
  if (limiters.some((r) => typeof r?.namespace_id !== "string" || !/^[1-9][0-9]*$/.test(r.namespace_id))) refuse("ratelimits.namespace_id", "must be a plain positive integer string without leading zero");
  const taken = new Set([...limiterIds(pilot, extra.ratelimitIds), ...limiterIds(sandbox)]);
  if (limiters.some((r) => taken.has(canonId(r?.namespace_id ?? "")))) refuse("ratelimits.namespace_id", "value matches a pilot or sandbox resource");
  return { ok: violations.length === 0, violations, warnings: [] };
}
