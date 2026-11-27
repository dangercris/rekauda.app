// The private tenant.json of a provisioning run: { slug, ownerEmail, config, qrPath }. It lives in the 0700 workdir, must be a
// plain file only the owner can read, and is validated with the same rules the Worker applies. Any problem is ONE generic
// error: no value, field name or path ever leaves this module. Imports TS that Node loads by type stripping (no runtime imports).
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseInstanceConfig } from "../../../src/shared/instance-validation.ts";
import { isValidSlug } from "../../../src/worker/tenancy/host.ts";
import { OWNER_EMAIL } from "../../../src/worker/tenancy/provision-sql.ts";

const KEYS = ["config", "ownerEmail", "qrPath", "slug"];

/** Returns { slug, ownerEmail (trimmed, lowercase), config, qrPath }, or throws `invalid tenant input`. */
export function loadTenantInput(dir) {
  try {
    const file = join(dir, "tenant.json");
    const stat = lstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("x");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join() !== KEYS.join()) throw new Error("x");
    const ownerEmail = typeof raw.ownerEmail === "string" ? raw.ownerEmail.trim().toLowerCase() : "";
    // Printable ASCII without a semicolon: the email is embedded in single-statement SQL literals.
    if (typeof raw.slug !== "string" || !isValidSlug(raw.slug) || !OWNER_EMAIL.test(ownerEmail) || !/^[\x21-\x7e]+$/.test(ownerEmail) || ownerEmail.includes(";")) throw new Error("x");
    if (typeof raw.qrPath !== "string" || !isAbsolute(raw.qrPath)) throw new Error("x");
    return { slug: raw.slug, ownerEmail, config: parseInstanceConfig(raw.config, "tenant config"), qrPath: raw.qrPath };
  } catch {
    throw new Error("invalid tenant input");
  }
}
