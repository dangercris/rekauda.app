import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = new URL(".", import.meta.url).pathname;
/** The methods of the remote each production data command may use. Changing this table is a reviewed decision. */
const EXPECTED_METHODS: Record<string, string[]> = { "prod:import": ["select", "file"], "prod:validate": ["select"], "prod:undo-data": ["select", "mutate"], "prod:undo-tenant": ["select", "mutate"], "prod:provision": ["select", "insert", "put"] };

function files(base: string): string[] {
  return readdirSync(base, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(base, e.name)) : [join(base, e.name)]));
}
const sources = files(dir)
  .filter((f) => !f.endsWith(".test.ts") && !f.endsWith("fake-checkout.ts"))
  .map((f) => ({ name: f.slice(dir.length), text: readFileSync(f, "utf8") }));

const provisionSources = sources.filter((s) => s.name.startsWith("lib/provision/"));

// The only files allowed to mention the flag: the guard and the wrapper, which exist to REJECT it.
const WRAPPER_FILES = ["cloud-wrangler.mjs", "lib/cloud-wrangler-core.mjs"];
const EXPORT_FILE = "lib/pilot-export.mjs";
const MENTIONS_REMOTE_FLAG = ["cloud-guard.mjs", ...WRAPPER_FILES, EXPORT_FILE];
const INVOKES_WRANGLER = /bin\/wrangler|\bwrangler\s+(d1|dev|deploy|r2|secret|types|versions|kv|delete)\b/;

// Every way of starting a process. Only the wrapper and the pilot export may do it (a lookbehind skips RegExp#exec).
const SPAWNS = /(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/;
const MAY_SPAWN = [...WRAPPER_FILES, EXPORT_FILE];

describe("scripts/ safety scan", () => {
  it("finds the scripts to scan", () => {
    expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(["cloud-wrangler.mjs", "lib/cloud-wrangler-core.mjs", "pending.sh", "review.sh"]));
  });

  it.each(sources)("$name never uses --remote outside the guard and the wrapper", ({ name, text }) => {
    if (!MENTIONS_REMOTE_FLAG.includes(name)) expect(text).not.toContain("--remote");
  });

  it.each(sources)("$name starts no process unless it is the wrapper or the pilot export", ({ name, text }) => {
    const code = text.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
    if (!MAY_SPAWN.includes(name)) expect(SPAWNS.test(code)).toBe(false);
  });

  it.each(sources)("$name invokes wrangler only through cloud-wrangler.mjs", ({ name, text }) => {
    if (!WRAPPER_FILES.includes(name)) expect(INVOKES_WRANGLER.test(text)).toBe(false);
  });
});

describe("the only path to --remote", () => {
  const wrapper = sources.find((s) => s.name === "lib/cloud-wrangler-core.mjs")!.text;
  // The functions allowed to build a --remote command line, each with its fixed config constant.
  // The read-only pilot export is the third remote path; it has its own describe below, with its own fixed argv builder.
  const REMOTE_FUNCTIONS = [
    { fn: "function runSandbox", config: "SANDBOX_CONFIG" },
    { fn: "function runProduction", config: "PRODUCTION_CONFIG" },
    // The remote of the production data commands (import, validation, undo): see "the production data path" below.
    { fn: "function productionRemote", config: "PRODUCTION_CONFIG" },
  ];
  const bodyOf = (fn: string) => {
    const from = wrapper.indexOf(fn);
    return { from, to: wrapper.indexOf("\n}\n", from), text: "" };
  };
  const bodies = REMOTE_FUNCTIONS.map((f) => {
    const range = bodyOf(f.fn);
    return { ...f, ...range, text: wrapper.slice(range.from, range.to) };
  });
  // Cut the ranges from the end of the file backwards, so the result does not depend on the order of the functions.
  const outside = [...bodies].sort((x, y) => y.from - x.from).reduce((rest, b) => rest.slice(0, b.from) + rest.slice(b.to), wrapper).split("\n");

  it.each(bodies)("lives in $fn of the wrapper", ({ from, text }) => {
    expect(from).toBeGreaterThan(-1);
    expect(text).toContain('"--remote"');
  });

  it("outside those functions, the wrapper mentions the flag only to reject it", () => {
    for (const line of outside.filter((l) => l.includes("--remote"))) {
      expect(line.trimStart().startsWith("//") || line.includes("FORBIDDEN_LONG")).toBe(true);
    }
  });

  it("confirm.mjs and the production loader never build a remote command", () => {
    const text = sources.find((s) => s.name === "lib/confirm.mjs")!.text;
    expect(text).not.toContain("--remote");
    expect(INVOKES_WRANGLER.test(text)).toBe(false);
  });

  it("the seed builder and the guard libraries never build a remote command", () => {
    for (const name of ["lib/cloud-sandbox-seed.mjs", "lib/cloud-guard-core.mjs", "lib/cloud-guard-io.mjs"]) {
      const text = sources.find((s) => s.name === name)!.text;
      expect(text, name).not.toContain("--remote");
      expect(INVOKES_WRANGLER.test(text), name).toBe(false);
    }
  });

  it.each(bodies)("every wrangler( call and remote step of $fn carries its fixed config", ({ config, text }) => {
    const lines = text.split("\n").filter((l) => l.includes("wrangler(") || l.includes('"--remote"'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain(config);
  });
});

describe("the pilot export path (read-only)", () => {
  const text = sources.find((s) => s.name === EXPORT_FILE)!.text;
  const code = text.split("\n").filter((l) => !l.trimStart().startsWith("//"));
  const builderFrom = text.indexOf("function buildExportArgv");
  const builder = text.slice(builderFrom, text.indexOf("\n}\n", builderFrom));

  it("builds the remote argv in one place, the fixed argv builder, with the fixed batch and nothing passed through", () => {
    expect(builderFrom).toBeGreaterThan(-1);
    expect(code.filter((l) => l.includes('"--config"'))).toHaveLength(1);
    expect(builder).toContain('"--config"');
    expect(code.filter((l) => l.includes("--remote"))).toHaveLength(1);
    expect(builder).toContain('"--remote"');
    expect(builder).toContain("SELECT_BATCH");
    expect(builder).not.toMatch(/\.\.\.|args|process\./);
  });

  it("spawns wrangler only with that builder's argv", () => {
    const spawns = code.filter((l) => /\bspawn\(/.test(l));
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toContain("buildExportArgv(");
    // The config is the generated one inside the workdir, which stops wrangler from searching parent directories.
    expect(spawns[0]).toMatch(/buildExportArgv\([^)]*join\(dir, [A-Z_]*CONFIG[A-Z_]*\)/);
    expect(spawns[0]).not.toMatch(/shell\s*:/);
    expect(code.join("\n")).not.toMatch(/\bshell\s*:/);
  });

  it("contains no write, schema or pragma statement and no other wrangler family", () => {
    expect(code.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA|REPLACE|VACUUM)\b/i);
    expect(code.join("\n")).not.toMatch(/"(r2|secret|deploy|delete|kv|versions|migrations|--file|--local)"/);
  });
});

describe("the production data path (reads and the import file)", () => {
  const wrapper = sources.find((s) => s.name === "lib/cloud-wrangler-core.mjs")!.text;
  const from = wrapper.indexOf("function productionRemote");
  const remote = wrapper.slice(from, wrapper.indexOf("\n}\n", from));
  const code = (text: string) => text.split("\n").filter((l) => !l.trimStart().startsWith("//"));

  it("has one spawn and two fixed argv, both with the production config: d1 execute (--command, --file) and the one QR upload", () => {
    expect(code(remote).filter((l) => /\bspawn\(/.test(l))).toHaveLength(1);
    const argv = code(remote).filter((l) => l.includes('"--remote"'));
    expect(argv).toHaveLength(2);
    expect(argv[0]).toContain('["d1", "execute", "DB", "--remote", "--json", ...PRODUCTION_CONFIG, flag, value]');
    expect(argv[1]).toContain('["r2", "object", "put", `${bucket}/t/${tenantId}/assets/deuna-qr.${ext}`, "--file", file, "--content-type", contentType, "--remote", ...PRODUCTION_CONFIG]');
    expect([...remote.matchAll(/invoke\("(--[a-z]+)"/g)].map((m) => m[1]).sort()).toEqual(["--command", "--command", "--command", "--file"]);
    expect(code(remote).filter((l) => /\bexec\(/.test(l)).length).toBe(2);
    expect(remote).not.toMatch(/\bshell\s*:|stdio: "inherit"|stdio: \[[^\]]*"inherit"/);
  });

  it("select accepts one SELECT statement only, and file only import.sql", () => {
    expect(remote).toContain('!sql.startsWith("SELECT ") || !sql.endsWith(";") || sql.slice(0, -1).includes(";")');
    expect(remote).toContain('basename(path) !== "import.sql"');
  });

  it("mutate accepts one scoped DELETE only: allowed table, a tenant UUID and the pilot_import guard", () => {
    expect(remote).toContain("!MUTABLE.test(sql) || !sql.includes(\" source = 'pilot_import'\") || !UUID_LITERAL.test(sql) || !sql.endsWith(\";\") || sql.slice(0, -1).includes(\";\")");
    expect(wrapper).toMatch(/const MUTABLE = \/\^DELETE FROM \(bank_movements\|students\|payments\|collections\|sessions\|magic_links\|memberships\|users\|tenant_domains\|tenants\) WHERE \//);
  });


  it("insert accepts one tenant INSERT only (allowed table, tenant UUID, single statement, pilot_import source), put only the staged QR into the receipts bucket", () => {
    expect(remote).toContain("!matchProvisionInsert(sql, expect)");
    expect(remote).toContain('b.binding === "RECEIPTS"');
    expect(remote).toContain("tenantId !== expect?.tenantId || !UUID.test(tenantId) || !Object.hasOwn(QR_TYPES, ext) || QR_TYPES[ext] !== contentType || !isStagedQr(file, expect.dir, ext)");
  });

  // Every remote.<method>( call site in the data modules (import and provision), and nothing else may reach the remote.
  const ALLOWED = {
    "lib/import/target.mjs": ["select", "select", "select"],
    "lib/import/apply.mjs": ["file"],
    "lib/import/validate.mjs": ["select"],
    "lib/import/undo.mjs": ["select", "select", "mutate", "select"],
    "lib/provision/provision.mjs": ["select", "select", "put", "insert", "select"],
  } as Record<string, string[]>;
  const importSources = sources.filter((s) => s.name.startsWith("lib/import/"));
  it("only these modules reach the remote, at exactly the allowed call sites", () => {
    const found = Object.fromEntries([...importSources, ...provisionSources].map((s) => [s.name, [...code(s.text).join("\n").matchAll(/\bremote\.(\w+)\(/g)].map((m) => m[1])]).filter(([, calls]) => (calls as string[]).length > 0));
    expect(found).toEqual(ALLOWED);
  });

  it("every select call site sends a SELECT built from constants and validated ids, and target.mjs has no write statement", () => {
    const target = sources.find((s) => s.name === "lib/import/target.mjs")!.text;
    for (const line of code(target).filter((l) => l.includes("remote.select("))) expect(line).toMatch(/remote\.select\((`SELECT |sql\))/);
    expect(code(target).join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA|REPLACE|VACUUM)\b/i);
    for (const name of ["lib/import/validate.mjs", "lib/import/undo.mjs"]) {
      const text = sources.find((s) => s.name === name)!.text;
      for (const line of code(text).filter((l) => l.includes("remote.select("))) expect(line, name).toMatch(/remote\.select\(`SELECT /);
      expect(code(text).join("\n"), name).not.toMatch(/\b(INSERT|UPDATE|DROP|ALTER|CREATE|ATTACH|PRAGMA|REPLACE|VACUUM)\b/i);
    }
  });

  // Every DELETE line must carry the pilot_import guard (a shared GUARD helper or the literal), and a user delete must also
  // carry the other-membership clause. The checker itself is proven by fixtures with a guard removed.
  it("the provision modules send only SELECTs built from constants and literals, and write no SQL of their own (the INSERTs come from provision-sql.ts)", () => {
    for (const s of provisionSources) {
      for (const line of code(s.text).filter((l) => l.includes("remote.select("))) expect(line, s.name).toMatch(/remote\.select\(`SELECT /);
      expect(code(s.text).join("\n"), s.name).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA|REPLACE|VACUUM)\b/);
    }
    expect(provisionSources.map((s) => s.name)).toEqual(expect.arrayContaining(["lib/provision/provision.mjs", "lib/provision/qr.mjs", "lib/provision/tenant-input.mjs", "lib/provision/inbound-token.mjs"]));
  });

  const deleteProblems = (line: string): string[] => {
    const problems: string[] = [];
    if (!line.includes("source = 'pilot_import'") && !line.includes("${GUARD(")) problems.push("no pilot_import guard");
    if (!/WHERE (tenant_id|id) = '\$\{(id|tenantId|u)\}'/.test(line)) problems.push("not scoped");
    if (line.includes("DELETE FROM users") && !line.includes("NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '${u}')")) problems.push("no other-membership clause");
    return problems;
  };

  it("the only DELETE statements live in undo.mjs, and every one carries its guards", () => {
    for (const s of [...importSources, ...provisionSources].filter((i) => !i.name.endsWith("undo.mjs"))) expect(code(s.text).join("\n"), s.name).not.toMatch(/\bDELETE\b/);
    const lines = code(sources.find((s) => s.name === "lib/import/undo.mjs")!.text).filter((l) => /DELETE FROM/.test(l));
    expect(lines.length).toBe(3);
    for (const line of lines) expect(deleteProblems(line), line).toEqual([]);
  });

  it("the DELETE checker fails when a guard is removed from a line", () => {
    const good = "const users = `DELETE FROM users WHERE id = '${u}' AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '${u}') AND ${GUARD(tenantId)};`;";
    expect(deleteProblems(good)).toEqual([]);
    expect(deleteProblems(good.replace(" AND ${GUARD(tenantId)}", ""))).toContain("no pilot_import guard");
    expect(deleteProblems(good.replace(" AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '${u}')", ""))).toContain("no other-membership clause");
    expect(deleteProblems("`DELETE FROM payments WHERE 1 = 1 AND ${GUARD(id)};`")).toContain("not scoped");
    expect(deleteProblems("`DELETE FROM tenants WHERE id = '${tenantId}';`")).toContain("no pilot_import guard");
  });

});

describe("the remote is used only in its plain form, in every module the data commands import", () => {
  const wrapper = sources.find((s) => s.name === "lib/cloud-wrangler-core.mjs")!.text;
  const code = (text: string) => text.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  // Anything but `remote.<method>(` is a way to hide a call from the call-site allowlist.
  const SNEAKY = [/\bremote\s*\?\./, /\bremote\s*\[/, /=\s*remote\b(?!\.\w+\()/, /\.\.\.remote\b/, /\bremote\.(?!\w+\()/, /(?<!\bremote)\.(select|mutate|file|insert|put)\(/];
  const violations = (text: string) => SNEAKY.filter((re) => re.test(code(text)));

  it("pins the data commands and the methods each one gets (least privilege)", () => {
    const block = wrapper.slice(wrapper.indexOf("const DATA_COMMANDS = {"), wrapper.indexOf("\n};\n", wrapper.indexOf("const DATA_COMMANDS = {")));
    const entries = [...block.matchAll(/^ {2}"(prod:[a-z-]+)": \{.*methods: (\[[^\]]*\])/gm)].map((m) => [m[1], JSON.parse(m[2]!.replaceAll("'", '"'))]);
    expect(Object.fromEntries(entries)).toEqual(EXPECTED_METHODS);
    expect([...block.matchAll(/^ {2}"(prod:[a-z-]+)":/gm)].map((m) => m[1])).toEqual(Object.keys(EXPECTED_METHODS));
  });

  it("scans every module imported from ./import/ or ./provision/ by the wrapper, and every module in ./provision/", () => {
    const imported = [...wrapper.matchAll(/from "\.\/(import|provision)\/([a-z-]+)\.mjs"/g)].map((m) => `lib/${m[1]}/${m[2]}.mjs`);
    expect(imported.length).toBeGreaterThanOrEqual(3);
    for (const name of [...new Set([...imported, ...provisionSources.map((s) => s.name)])]) {
      const text = sources.find((s) => s.name === name)?.text;
      expect(text, name).toBeDefined();
      expect(violations(text!), name).toEqual([]);
    }
  });

  it("catches every way of hiding a call (the fixtures must fail)", () => {
    for (const bad of ["remote?.mutate(sql);", 'remote["mutate"](sql);', "const { mutate } = remote;", "const r = remote;", "const f = remote.file;", "run(...remote);", "remote.select.call(x, sql);", "other.mutate(sql);", "r.insert(x);", "other.put(y);", "const { insert } = remote;"]) expect(violations(bad), bad).not.toEqual([]);
    for (const good of ["remote.select(sql);", "targetVerdict(remote, plan);", "export function runX({ a }, { remote, log = console }) {", "if (x) remote.file(path);", "const rows = remote.select(sql);"]) expect(violations(good), good).toEqual([]);
  });
});

// Node loads these TS files directly (type stripping, Node >= 22.18): no runtime import, no enum, no namespace, no parameter
// property. Node would need explicit extensions and cannot transform those. The checker is proven by fixtures.
const tsProblems = (text: string): string[] => {
  const stripped = text.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  const problems: string[] = [];
  if (/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["'][^"']+["']/m.test(stripped)) problems.push("runtime import");
  if (/\bimport\s*\(/.test(stripped)) problems.push("dynamic import");
  if (/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s/m.test(stripped)) problems.push("enum");
  if (/^\s*(?:export\s+)?(?:declare\s+)?namespace\s+\w/m.test(stripped)) problems.push("namespace");
  if (/constructor\s*\(\s*(?:[^)]*?\b)?(?:public|private|protected|readonly)\s+\w/.test(stripped)) problems.push("parameter property");
  return problems;
};

describe("TS files that Node loads from the scripts", () => {
  const loaded = [...new Set(sources.flatMap((s) => [...s.text.matchAll(/from "((?:\.\.?\/)+[^"]*\.ts)"/g)].map((m) => new URL(m[1]!, new URL(s.name, "file://" + dir)).pathname)))];
  it("finds the TS files the scripts import", () => {
    for (const name of ["storage/keys.ts", "shared/instance-validation.ts", "tenancy/host.ts", "tenancy/provision-sql.ts"]) expect(loaded.some((f) => f.endsWith("/src/" + (name.startsWith("shared") ? name : "worker/" + name))), name).toBe(true);
  });
  it.each(loaded.map((f) => [f.slice(f.indexOf("/src/") + 1), f]))("%s needs nothing but type stripping", (_name, file) => {
    expect(tsProblems(readFileSync(file as string, "utf8"))).toEqual([]);
  });
  it("the checker flags every construct Node cannot strip (the fixtures must fail)", () => {
    for (const bad of ['import { a } from "./x";', 'import x from "./x";', 'import "./side";', 'import * as m from "./m";', 'export * from "./m";', 'export { a } from "./m";', 'import {\n  a,\n} from "./x";', 'import { type A } from "./x";', "const m = await import(\"./x\");", "export enum A { B }", "const enum A { B }", "namespace N { }", "class C { constructor(private x: number) {} }"]) expect(tsProblems(bad), bad).not.toEqual([]);
    for (const good of ['import type { A } from "./x";', 'export type { A } from "./x";', "export const a = 1;", 'export const PREFIX = "x";', "export function f(): string { return 'import'; }", "// import { a } from './x';", "class C { constructor(x: number) {} }"]) expect(tsProblems(good), good).toEqual([]);
  });
});

describe("pilot ops shell scripts on this branch", () => {
  it.each(["pending.sh", "review.sh"])("%s refuses to run and exits 1", (name) => {
    const result = spawnSync("bash", [dir + name, "ABC-DEF", "recibido", "details"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
  });
});
