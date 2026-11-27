// The check behind `remote.insert`: a statement is accepted only when it equals, byte for byte, one of the four statements
// provisionTenantStatements renders (whitespace collapsed, every placeholder replaced by one literal), for ONE expected tenant id
// and ONE expected owner id. No ON CONFLICT ... DO UPDATE, no SELECT other than the membership template, no subquery, no extra
// statement can match, because the text outside the literals is the template itself. Extra rules pin the values that matter:
// every whole-UUID literal is the tenant id (or, in the user row only, the owner id), the prefix is t/<tenant>/, the source is
// pilot_import, the QR key is the tenant's own assets key. Imports TS that Node loads by type stripping.
import { provisionTenantStatements } from "../../../src/worker/tenancy/provision-sql.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_LITERALS = /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g;
const LITERAL = "('(?:[^']|'')*'|NULL)";
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The template of each statement as a regular expression, and the placeholder numbers in the order their groups appear. */
function matcher(template) {
  const group = new Map();
  const source = template
    .split(/(\?\d+)/)
    .map((part) => {
      const placeholder = /^\?(\d+)$/.exec(part);
      if (!placeholder) return escape(part);
      if (group.has(placeholder[1])) return `\\${group.get(placeholder[1])}`;
      group.set(placeholder[1], group.size + 1);
      return LITERAL;
    })
    .join("");
  return { re: new RegExp(`^${source};$`), numbers: [...group.keys()].map(Number) };
}

// The SQL of the templates does not depend on the values, so any row yields the same four templates.
const SAMPLE = { id: "i", slug: "s", hostname: "h", configJson: "{}", ownerEmail: "e", ownerId: "o", nowIso: "n", source: "pilot_import" };
const MATCHERS = provisionTenantStatements(SAMPLE).map(({ sql }) => matcher(sql.replace(/\s+/g, " ")));

const unquote = (token) => (token === "NULL" ? null : token.slice(1, -1).replaceAll("''", "'"));

/** Value rules per statement, over the literal of each placeholder number. */
const RULES = [
  (v, { tenantId }) => v[1] === tenantId && v[4] === `t/${tenantId}/` && v[5] === "pilot_import" && (v[6] === null || new RegExp(`^t/${tenantId}/assets/deuna-qr\\.(png|jpg|webp)$`).test(v[6])) && (v[7] === null || /^[0-9a-f]{64}$/.test(v[7])),
  (v, { tenantId }) => v[2] === tenantId,
  (v, { ownerId }) => v[1] === ownerId,
  (v, { tenantId }) => v[1] === tenantId,
];

/** True when `sql` is exactly one of the four provisioning statements for this tenant and owner. */
export function matchProvisionInsert(sql, expectation) {
  const { tenantId, ownerId } = expectation ?? {};
  if (typeof sql !== "string" || !UUID.test(tenantId) || !UUID.test(ownerId)) return false;
  for (const [index, { re, numbers }] of MATCHERS.entries()) {
    const found = re.exec(sql);
    if (!found) continue;
    const values = Object.fromEntries(numbers.map((n, i) => [n, unquote(found[i + 1])]));
    const allowed = index === 2 ? [`'${ownerId}'`] : [`'${tenantId}'`];
    return RULES[index](values, { tenantId, ownerId }) && (sql.match(UUID_LITERALS) ?? []).every((literal) => allowed.includes(literal));
  }
  return false;
}
