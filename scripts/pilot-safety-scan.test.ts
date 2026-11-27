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
const MENTIONS_REMOTE_FLAG = ["cloud-guard.mjs", ...WRAPPER_FILES];
const INVOKES_WRANGLER = /bin\/wrangler|\bwrangler\s+(d1|dev|deploy|r2|secret|types|versions|kv|delete)\b/;

describe("scripts/ safety scan", () => {
  it("finds the scripts to scan", () => {
    expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(["cloud-wrangler.mjs", "lib/cloud-wrangler-core.mjs", "pending.sh", "review.sh"]));
  });

  it.each(sources)("$name never uses --remote outside the guard and the wrapper", ({ name, text }) => {
    if (!MENTIONS_REMOTE_FLAG.includes(name)) expect(text).not.toContain("--remote");
  });

  it.each(sources)("$name invokes wrangler only through cloud-wrangler.mjs", ({ name, text }) => {
    if (!WRAPPER_FILES.includes(name)) expect(INVOKES_WRANGLER.test(text)).toBe(false);
  });
});

describe("the only path to --remote", () => {
  const wrapper = sources.find((s) => s.name === "lib/cloud-wrangler-core.mjs")!.text;
  // The functions allowed to build a --remote command line, each with its fixed config constant.
  // pilot-export joins this list in its own change.
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

describe("pilot ops shell scripts on this branch", () => {
  it.each(["pending.sh", "review.sh"])("%s refuses to run and exits 1", (name) => {
    const result = spawnSync("bash", [dir + name, "ABC-DEF", "recibido", "details"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
  });
});
