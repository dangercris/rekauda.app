/**
 * Fail-closed tenant scope checker for the SQL a tenant handler may send to D1. One implementation, used by
 * TenantDb.prepare() at runtime and by the SQL spy in tests.
 *
 * It tokenizes the SQL and accepts only a deliberately small subset; anything it does not understand is rejected.
 * What it enforces, exactly:
 *  - one SELECT, INSERT, UPDATE or DELETE statement, no comments, no quoted identifiers, only numbered parameters
 *    (?1..?N, contiguous, ?1 required), single-quoted and numeric literals;
 *  - tables only from TENANT_TABLES, written unqualified, no derived tables, no comma joins, no duplicate aliases;
 *  - none of: OR, UNION, INTERSECT, EXCEPT, WITH, REPLACE, RETURNING, PRAGMA, ATTACH, ON CONFLICT DO UPDATE;
 *  - only plain, INNER, CROSS and LEFT [OUTER] joins (no RIGHT, FULL, NATURAL) and no UPDATE ... FROM;
 *  - every table reference in every SELECT/UPDATE/DELETE scope (sub-selects included) has its own
 *    `<alias>.tenant_id = ?1` (unqualified only when the scope has one table) as a top-level AND conjunct of WHERE, or
 *    of the ON of the very JOIN that introduces that table (never for the FROM table or an earlier table), outside
 *    CASE, parentheses and BETWEEN, and not negated;
 *  - ?1 appears only in those predicates or in the tenant_id slot of INSERT ... VALUES, never elsewhere;
 *  - UPDATE cannot assign tenant_id; INSERT must list tenant_id, bind it to ?1 in every row, and cannot be INSERT ... SELECT.
 * What it does NOT do: it does not parse expressions beyond that, so it does not prove anything about other conditions.
 * The caller binds ?1 to the tenant id (TenantDb), and the spy test asserts that on every executed statement.
 */

export class TenantScopeViolation extends Error {}

/** Tables a tenant handler may touch. tenants, tenant_domains and users are platform tables and are denied here. */
export const TENANT_TABLES: ReadonlySet<string> = new Set(["collections", "payments", "students", "bank_movements", "memberships", "sessions", "magic_links"]);

type Tok = { t: "id" | "str" | "num" | "param" | "p"; v: string; n?: number };
type Sub = { t: "sub"; items: Item[] };
type Item = Tok | Sub;

const BANNED = new Set(["or", "union", "intersect", "except", "with", "recursive", "replace", "returning", "pragma", "attach", "detach"]);
const NOT_ALIAS = new Set(["where", "on", "left", "right", "inner", "cross", "outer", "natural", "join", "group", "order", "limit", "having", "set", "using", "and", "from", "values"]);
const AFTER_PREDICATE = new Set(["and", "group", "order", "limit", "having", "where", "join", "left", "right", "inner", "cross", "natural"]);
/** RIGHT and FULL joins make the left table nullable and NATURAL joins pick columns implicitly, so none can be scoped soundly. */
const JOIN_BANNED = new Set(["right", "full", "natural"]);
const PUNCT = "(),.=<>!*+-/%|";

function violation(reason: string): never {
  throw new TenantScopeViolation(reason);
}

function tokenize(sql: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const c = rest.charAt(0);
    let m: RegExpExecArray | null;
    if (/\s/.test(c)) {
      i += 1;
    } else if ((m = /^'(?:[^']|'')*'/.exec(rest))) {
      toks.push({ t: "str", v: m[0] });
      i += m[0].length;
    } else if ((m = /^\?(\d+)(?![\w])/.exec(rest))) {
      toks.push({ t: "param", v: m[0], n: Number(m[1]) });
      i += m[0].length;
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      toks.push({ t: "id", v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ((m = /^\d+(?:\.\d+)?(?![\w.])/.exec(rest))) {
      toks.push({ t: "num", v: m[0] });
      i += m[0].length;
    } else if (c === "-" && rest.charAt(1) === "-") {
      return violation("comments are not allowed");
    } else if (c === "/" && rest.charAt(1) === "*") {
      return violation("comments are not allowed");
    } else if (c !== "" && PUNCT.includes(c)) {
      toks.push({ t: "p", v: c });
      i += 1;
    } else {
      return violation("unsupported character, quoted identifier or parameter style");
    }
  }
  return toks;
}

const isId = (x: Item | undefined, v?: string): x is Tok => x?.t === "id" && (v === undefined || x.v === v);
const isP = (x: Item | undefined, v: string): x is Tok => x?.t === "p" && x.v === v;

/** Groups parenthesised sub-selects into Sub items. Other parentheses stay flat and are tracked by depth. */
function nest(toks: Tok[], pos: { i: number }, nested: boolean): Item[] {
  const items: Item[] = [];
  let depth = 0;
  while (pos.i < toks.length) {
    const tok = toks[pos.i] as Tok;
    pos.i += 1;
    if (isP(tok, "(") && isId(toks[pos.i], "select")) items.push({ t: "sub", items: nest(toks, pos, true) });
    else if (isP(tok, ")") && depth === 0) {
      if (!nested) return violation("unbalanced parentheses");
      return items;
    } else {
      if (isP(tok, "(")) depth += 1;
      if (isP(tok, ")")) depth -= 1;
      if (isId(tok, "select") && items.length > 0) return violation("unexpected SELECT");
      items.push(tok);
    }
  }
  if (nested || depth !== 0) return violation("unbalanced parentheses");
  return items;
}

interface Ref {
  alias: string;
  satisfied: boolean;
}

interface State {
  /** How many ?1 were consumed by a recognised tenant predicate or INSERT slot. */
  p1Used: number;
}

/** Scans one SELECT, UPDATE or DELETE scope: registers table refs and matches tenant predicates. */
function scanScope(items: Item[], state: State): void {
  const refs: Ref[] = [];
  let clause = "";
  let depth = 0;
  let caseDepth = 0;
  let between = 0;
  let boundary = false;
  let setStart = false;
  /** Table introduced by the JOIN whose ON clause is being read. Only it may be scoped in that ON. */
  let joinRef: Ref | null = null;
  const first = items[0];
  if (!isId(first) || !["select", "update", "delete"].includes(first.v)) return violation("unsupported statement");
  const addRef = (at: number, comma: boolean, join: boolean): number => {
    const table = items[at];
    if (!isId(table) || !TENANT_TABLES.has(table.v) || isP(items[at + 1], ".")) return violation("table is not allowed here");
    let next = at + 1;
    let alias = table.v;
    const maybe = items[next];
    const word = maybe?.t === "id" ? maybe.v : undefined;
    if (word === "as") {
      const named = items[next + 1];
      if (!isId(named) || NOT_ALIAS.has(named.v)) return violation("invalid alias");
      alias = named.v;
      next += 2;
    } else if (word !== undefined && !NOT_ALIAS.has(word)) {
      alias = word;
      next += 1;
    }
    if (refs.some((r) => r.alias === alias)) return violation(`duplicate alias ${alias}`);
    const ref = { alias, satisfied: false };
    refs.push(ref);
    joinRef = join ? ref : null;
    if (comma && isP(items[next], ",")) return violation("comma joins are not allowed, use JOIN ... ON");
    return next;
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Item;
    if (it.t === "sub") {
      scanScope(it.items, state);
      boundary = false;
      continue;
    }
    if (it.t === "id" && BANNED.has(it.v)) return violation(`${it.v.toUpperCase()} is not allowed`);
    if (it.t === "id" && JOIN_BANNED.has(it.v)) return violation(`${it.v.toUpperCase()} joins are not allowed`);
    if (isId(it, "outer") && !isId(items[i - 1], "left")) return violation("only LEFT OUTER JOIN is allowed");
    if (it.t === "id" && isP(items[i + 1], ".") && isP(items[i + 3], ".")) return violation("schema-qualified names are not allowed");
    if (clause === "set" && depth === 0 && (setStart || isP(it, ","))) {
      const comma = isP(it, ",");
      const target = comma ? items[i + 1] : it;
      const name = isId(target) && isP(items[i + (comma ? 2 : 1)], ".") ? items[i + (comma ? 3 : 2)] : target;
      if (!isId(name) || name.v === "tenant_id") return violation("UPDATE cannot assign tenant_id or use a column list");
      setStart = false;
    }
    if (isP(it, "(")) depth += 1;
    else if (isP(it, ")")) depth -= 1;
    if (depth === 0 && isP(it, ",") && (clause === "from" || clause === "on")) return violation("comma joins are not allowed, use JOIN ... ON");

    if (depth === 0 && it.t === "id") {
      const v = it.v;
      if (i === 0 && v === "update") {
        i = addRef(1, false, false) - 1;
        clause = "update";
        continue;
      }
      if (v === "from" && first.v === "update") return violation("UPDATE ... FROM is not allowed");
      if (v === "from" || v === "join") {
        i = addRef(i + 1, v === "from", v === "join") - 1;
        clause = v === "from" ? "from" : "on";
        boundary = false;
        continue;
      }
      if (v === "set") {
        clause = "set";
        setStart = true;
        continue;
      }
      if (["where", "on"].includes(v)) {
        clause = v;
        boundary = true;
        continue;
      }
      if (["group", "order", "limit", "having", "select"].includes(v)) clause = v;
      if (v === "case") caseDepth += 1;
      if (v === "end") caseDepth -= 1;
      if (v === "between") between += 1;
      if (v === "and") {
        if (between > 0) {
          between -= 1;
          boundary = false;
        } else boundary = true;
        continue;
      }
    }

    if (boundary && depth === 0 && caseDepth === 0 && (clause === "where" || clause === "on") && isId(it)) {
      const qualified = isP(items[i + 1], ".") && isId(items[i + 2], "tenant_id");
      const bare = it.v === "tenant_id" && !isP(items[i - 1], ".");
      const at = qualified ? i + 3 : bare ? i + 1 : -1;
      const param = items[at + 1];
      if (at >= 0 && isP(items[at], "=") && param?.t === "param" && param.n === 1) {
        const after = items[at + 2];
        if (after && !(isId(after) && AFTER_PREDICATE.has(after.v))) return violation("tenant predicate must be a plain AND conjunct");
        const ref = qualified ? refs.find((r) => r.alias === it.v) : refs.length === 1 ? refs[0] : undefined;
        if (!ref) return violation("tenant predicate does not name a table of this scope");
        if (clause === "on" && ref !== joinRef) return violation("an ON predicate only counts for the table that JOIN introduces, scope the others in WHERE");
        ref.satisfied = true;
        state.p1Used += 1;
        i = at + 1;
        boundary = false;
        if (isId(after, "and")) {
          boundary = true;
          i += 1;
        }
        continue;
      }
    }
    boundary = false;
  }
  if (depth !== 0) return violation("unbalanced parentheses");
  const missing = refs.find((r) => !r.satisfied);
  if (missing) return violation(`alias ${missing.alias} has no tenant_id = ?1 predicate`);
  if (refs.length === 0 && first.v !== "select") return violation("statement has no table");
}

const flatText = (items: Item[]): string => items.map((x) => (x.t === "id" || x.t === "p" ? x.v : "?")).join(" ");

/** INSERT INTO t (cols) VALUES (...) [, (...)] [ON CONFLICT [(cols)] DO NOTHING] with ?1 in the tenant_id slot of every row. */
function scanInsert(items: Item[], state: State): void {
  const table = items[2];
  if (!isId(items[1], "into") || !isId(table) || !TENANT_TABLES.has(table.v) || !isP(items[3], "(")) return violation("unsupported INSERT form");
  const close = items.findIndex((x, k) => k > 3 && isP(x, ")"));
  const colText = flatText(items.slice(4, close < 0 ? 4 : close));
  if (close < 0 || !/^\w+( , \w+)*$/.test(colText)) return violation("unsupported INSERT column list");
  const cols = colText.split(" , ");
  const slot = cols.indexOf("tenant_id");
  if (slot < 0 || cols.lastIndexOf("tenant_id") !== slot) return violation("INSERT must list tenant_id exactly once");
  let i = close + 1;
  if (!isId(items[i], "values")) return violation("only INSERT ... VALUES is allowed");
  i += 1;
  for (;;) {
    if (!isP(items[i], "(")) return violation("unsupported VALUES list");
    i += 1;
    const cells: Item[][] = [[]];
    for (let depth = 0; ; i++) {
      const it = items[i];
      if (!it) return violation("unbalanced parentheses");
      if (isP(it, ")") && depth === 0) break;
      if (it.t === "sub") scanScope(it.items, state);
      if (it.t === "id" && BANNED.has(it.v)) return violation(`${it.v.toUpperCase()} is not allowed`);
      if (isP(it, "(")) depth += 1;
      if (isP(it, ")")) depth -= 1;
      if (isP(it, ",") && depth === 0) cells.push([]);
      else (cells[cells.length - 1] as Item[]).push(it);
    }
    i += 1;
    const cell = cells[slot]?.[0];
    if (cells.length !== cols.length || cells[slot]?.length !== 1 || cell?.t !== "param" || cell.n !== 1) return violation("?1 must be the tenant_id value of every row");
    state.p1Used += 1;
    if (!isP(items[i], ",")) break;
    i += 1;
  }
  if (i < items.length && !/^on conflict (\( \w+( , \w+)* \) )?do nothing$/.test(flatText(items.slice(i)))) {
    return violation("only ON CONFLICT DO NOTHING is allowed after VALUES");
  }
}

/** Throws TenantScopeViolation unless the SQL is inside the allowed subset. Returns the number of parameters (?1..?N). */
export function assertTenantScoped(sql: string): number {
  const body = tokenize(sql.trimEnd().replace(/;$/, ""));
  const items = nest(body, { i: 0 }, false);
  const state: State = { p1Used: 0 };
  const numbers = body.flatMap((t) => (t.t === "param" ? [t.n ?? 0] : []));
  const p1Seen = numbers.filter((n) => n === 1).length;
  const kind = isId(items[0]) ? items[0].v : "";
  if (kind === "insert") scanInsert(items, state);
  else scanScope(items, state);
  if (p1Seen === 0 || p1Seen !== state.p1Used) return violation("?1 may only be the tenant id in a tenant_id predicate or INSERT slot");
  const max = Math.max(...numbers);
  for (let n = 1; n <= max; n++) if (!numbers.includes(n)) return violation("numbered parameters must be contiguous from ?1");
  return max;
}
