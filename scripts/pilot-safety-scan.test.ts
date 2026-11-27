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

describe("pilot ops shell scripts on this branch", () => {
  it.each(["pending.sh", "review.sh"])("%s refuses to run and exits 1", (name) => {
    const result = spawnSync("bash", [dir + name, "ABC-DEF", "recibido", "details"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
  });
});
