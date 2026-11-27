import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = new URL(".", import.meta.url).pathname;

function files(base: string): string[] {
  return readdirSync(base, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(base, e.name)) : [join(base, e.name)]));
}
const sources = files(dir)
  .filter((f) => !f.endsWith(".test.ts") && !f.endsWith("fake-checkout.ts"))
  .map((f) => ({ name: f.slice(dir.length), text: readFileSync(f, "utf8") }));

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

  it("has one spawn, one fixed argv with the production config, and only the --command and --file flags (select, mutate, file)", () => {
    expect(code(remote).filter((l) => /\bspawn\(/.test(l))).toHaveLength(1);
    const argv = code(remote).filter((l) => l.includes('"--remote"'));
    expect(argv).toHaveLength(1);
    expect(argv[0]).toContain('["d1", "execute", "DB", "--remote", "--json", ...PRODUCTION_CONFIG, flag, value]');
    expect([...remote.matchAll(/invoke\("(--[a-z]+)"/g)].map((m) => m[1]).sort()).toEqual(["--command", "--command", "--file"]);
    expect(remote).not.toMatch(/\bshell\s*:|stdio: "inherit"|stdio: \[[^\]]*"inherit"/);
  });

  it("select accepts one SELECT statement only, and file only import.sql", () => {
    expect(remote).toContain('!sql.startsWith("SELECT ") || !sql.endsWith(";") || sql.slice(0, -1).includes(";")');
    expect(remote).toContain('basename(path) !== "import.sql"');
  });

  it("mutate accepts one DELETE statement only", () => {
    expect(remote).toContain('!/^DELETE FROM [a-z_]+ WHERE /.test(sql) || !sql.endsWith(";") || sql.slice(0, -1).includes(";")');
  });

  // Every remote.<method>( call site in the import modules, and nothing else may reach the remote.
  const ALLOWED = {
    "lib/import/target.mjs": ["select", "select", "select"],
    "lib/import/apply.mjs": ["file"],
    "lib/import/validate.mjs": ["select"],
    "lib/import/undo.mjs": ["select", "mutate"],
  } as Record<string, string[]>;
  const importSources = sources.filter((s) => s.name.startsWith("lib/import/"));
  it("only these modules reach the remote, at exactly the allowed call sites", () => {
    const found = Object.fromEntries(importSources.map((s) => [s.name, [...code(s.text).join("\n").matchAll(/\bremote\.(\w+)\(/g)].map((m) => m[1])]).filter(([, calls]) => (calls as string[]).length > 0));
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

  it("the only DELETE statements live in undo.mjs, each scoped by tenant_id or by the tenant id with the pilot_import source", () => {
    for (const s of importSources.filter((i) => !i.name.endsWith("undo.mjs"))) expect(code(s.text).join("\n"), s.name).not.toMatch(/\bDELETE\b/);
    const undo = code(sources.find((s) => s.name === "lib/import/undo.mjs")!.text).filter((l) => /DELETE FROM/.test(l));
    expect(undo.length).toBeGreaterThan(0);
    for (const line of undo) expect(line).toMatch(/WHERE (tenant_id|id) = '\$\{(id|tenantId)\}'|WHERE id = '\$\{u\}'/);
  });
});

describe("pilot ops shell scripts on this branch", () => {
  it.each(["pending.sh", "review.sh"])("%s refuses to run and exits 1", (name) => {
    const result = spawnSync("bash", [dir + name, "ABC-DEF", "recibido", "details"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
  });
});
