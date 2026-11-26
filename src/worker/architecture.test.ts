/// <reference types="node" />
/**
 * Architecture scan: raw tenant bindings (D1, R2, mail archive, send_email) may be named only in the composition root,
 * the platform data path and the adapters that wrap them. Everything else gets a RequestContext. Comments are ignored.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL(".", import.meta.url).pathname;

/** Names of the raw bindings and their types. Any identifier (or string-literal key) with one of these names counts. */
const RAW_NAMES = ["DB", "RECEIPTS", "MAIL_ARCHIVE", "SEND_EMAIL", "D1Database", "R2Bucket"];

/** Files allowed to name a raw binding, and which names each may use. */
const ALLOWLIST: Record<string, string[]> = {
  "index.ts": ["DB", "RECEIPTS"],
  "env.ts": ["DB", "RECEIPTS", "MAIL_ARCHIVE", "SEND_EMAIL", "D1Database", "R2Bucket"],
  "context.ts": ["D1Database", "R2Bucket"],
  "data/platform-db.ts": ["D1Database"],
  "data/tenant-db.ts": ["D1Database"],
  "storage/tenant-storage.ts": ["R2Bucket"],
};

/**
 * Minimal TypeScript lexer: returns identifiers and string-literal values found in CODE only. It skips comments, and
 * it handles string, template (including `${...}` expressions) and regex literals BEFORE looking for comments, so a
 * `//` or `/*` inside a string or regex cannot hide code. Destructuring, aliases, bracket and optional access all
 * surface as plain identifier/string tokens, so no syntax-specific pattern is needed.
 */
export function codeTokens(source: string): string[] {
  const out: string[] = [];
  const closers: Array<"template" | "brace"> = [];
  let i = 0;
  let prev = "";
  const regexAllowed = () => prev === "" || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || ["return", "typeof", "case", "in", "of", "void"].includes(prev);
  const template = () => {
    // Inside a template literal, up to the next `${` (pushes a brace frame) or the closing backtick.
    while (i < source.length) {
      const c = source[i] as string;
      if (c === "\\") i += 2;
      else if (c === "`") {
        i += 1;
        return;
      } else if (c === "$" && source[i + 1] === "{") {
        i += 2;
        closers.push("template");
        return;
      } else i += 1;
    }
  };
  while (i < source.length) {
    const c = source[i] as string;
    const n = source[i + 1];
    if (/\s/.test(c)) i += 1;
    else if (c === "/" && n === "/") while (i < source.length && source[i] !== "\n") i += 1;
    else if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      out.push(source.slice(i + 1, j));
      i = j + 1;
      prev = "str";
    } else if (c === "`") {
      i += 1;
      template();
      prev = "str";
    } else if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && (inClass || source[j] !== "/") && source[j] !== "\n") {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        j += 1;
      }
      i = j + 1;
      prev = "str";
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < source.length && /[\w$]/.test(source[j] as string)) j += 1;
      prev = source.slice(i, j);
      out.push(prev);
      i = j;
    } else if (/\d/.test(c)) {
      while (i < source.length && /[\w.]/.test(source[i] as string)) i += 1;
      prev = "num";
    } else {
      if (c === "{") closers.push("brace");
      if (c === "}" && closers.pop() === "template") {
        i += 1;
        template();
        prev = "str";
        continue;
      }
      prev = c;
      i += 1;
    }
  }
  return out;
}

export function scanSource(file: string, source: string): string[] {
  const allowed = ALLOWLIST[file] ?? [];
  const seen = new Set(codeTokens(source));
  return RAW_NAMES.filter((name) => seen.has(name) && !allowed.includes(name)).map((name) => `${file}: ${name}`);
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "test" ? [] : productionFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

describe("raw binding allowlist", () => {
  it("detects each kind of raw binding access in a non-allowlisted file", () => {
    const snippets: Array<[string, string]> = [
      ["DB", "await env.DB.prepare('x')"],
      ["RECEIPTS", "const o = await env.RECEIPTS.get(k)"],
      ["MAIL_ARCHIVE", "env.MAIL_ARCHIVE.put(k, v)"],
      ["SEND_EMAIL", "await env.SEND_EMAIL.send(m)"],
      ["DB", 'type E = Pick<Env, "DB">'],
      ["D1Database", "function f(db: D1Database) {}"],
      ["R2Bucket", "function f(b: R2Bucket) {}"],
    ];
    for (const [name, code] of snippets) expect(scanSource("handler.ts", code)).toContain(`handler.ts: ${name}`);
  });

  it.each([
    ["string with // before the access", 'const u = "a//b"; env.DB.prepare("x")'],
    ["glob string opening a fake block comment", 'const g = "/api/*"; env.DB.prepare("x"); // end */'],
    ["destructuring in a parameter", "function f({ DB }: BaseEnv) { return DB.prepare('x'); }"],
    ["destructuring through an alias", "const e = env; const { DB } = e;"],
    ["bracket access", 'env["RECEIPTS"].get(k)'],
    ["template literal expression", "const q = `${env.DB}`;"],
    ["optional chaining", "env?.DB.prepare('x')"],
    ["regex literal before the access", "const r = /a\\/\\/b/; env.DB.prepare('x')"],
    ["rename in destructuring", "const { DB: db } = env;"],
  ])("detects a bypass attempt: %s", (_name, code) => {
    expect(scanSource("handler.ts", code).length).toBeGreaterThan(0);
  });

  it("ignores mentions in comments and accepts allowlisted uses only for their own patterns", () => {
    expect(scanSource("handler.ts", "// never call env.DB here\n/* env.RECEIPTS */ const x = 1;")).toEqual([]);
    expect(scanSource("index.ts", "env.DB.prepare('x')")).toEqual([]);
    expect(scanSource("index.ts", "env.MAIL_ARCHIVE.put(k, v)")).toEqual(["index.ts: MAIL_ARCHIVE"]);
    expect(scanSource("context.ts", "env.DB.prepare('x')")).toEqual(["context.ts: DB"]);
    expect(scanSource("handler.ts", 'const text = "see env.DB and D1Database in this string";')).toEqual([]);
  });

  it("does not let a real access hide after tricky literals, and does not flag code after them", () => {
    expect(codeTokens("const a = `x${y}z`; const b = 1 / 2; env.DB")).toContain("DB");
    expect(codeTokens("const re = /[/]DB/; const n = 4")).not.toContain("DB");
  });

  it("sees all of og.ts and boot.ts (the old comment stripper hid about 1.7k characters of og.ts)", () => {
    expect(codeTokens(readFileSync(join(ROOT, "og.ts"), "utf8"))).toContain("withPageHeaders");
    expect(codeTokens(readFileSync(join(ROOT, "boot.ts"), "utf8"))).toContain("HTMLRewriter");
  });

  it("keeps the bundled config out of the Worker except behind the single-mode ConfigStore", () => {
    const importsBundled = productionFiles(ROOT)
      .filter((path) => /from "[^"]*(rekauda\.config|instance-bundled)"/.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path));
    expect(importsBundled).toEqual(["tenancy/config-store.ts"]);
    const tokens = codeTokens(readFileSync(join(ROOT, "constants.ts"), "utf8"));
    expect(tokens.filter((t) => ["TREASURY", "BANKS", "SCHOOL_NAME", "CLASS_NAME", "DEFAULT_TONE", "EARLIEST_TRANSFER"].includes(t))).toEqual([]);
  });

  it("holds for every production file under src/worker", () => {
    const files = productionFiles(ROOT);
    expect(files.length).toBeGreaterThan(20);
    const violations = files.flatMap((path) => scanSource(relative(ROOT, path), readFileSync(path, "utf8")));
    expect(violations).toEqual([]);
  });
});
