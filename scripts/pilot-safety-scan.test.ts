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
  const start = wrapper.indexOf("function runSandbox");
  const end = wrapper.indexOf("/** root ends with a slash");
  const outsideSandbox = (wrapper.slice(0, start) + wrapper.slice(end)).split("\n");

  it("lives in the sandbox function of the wrapper", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(wrapper.slice(start, end)).toContain('"--remote"');
  });

  it("outside that function, the wrapper mentions the flag only to reject it", () => {
    for (const line of outsideSandbox.filter((l) => l.includes("--remote"))) {
      expect(line.trimStart().startsWith("//") || line.includes("FORBIDDEN_LONG")).toBe(true);
    }
  });

  it("the seed builder and the guard libraries never build a remote command", () => {
    for (const name of ["lib/cloud-sandbox-seed.mjs", "lib/cloud-guard-core.mjs", "lib/cloud-guard-io.mjs"]) {
      const text = sources.find((s) => s.name === name)!.text;
      expect(text, name).not.toContain("--remote");
      expect(INVOKES_WRANGLER.test(text), name).toBe(false);
    }
  });

  it("every remote step of the sandbox function carries the fixed sandbox config", () => {
    const body = wrapper.slice(start, end);
    expect(body).toContain("SANDBOX_CONFIG");
    for (const line of body.split("\n").filter((l) => l.includes('"--remote"'))) expect(line).toContain("SANDBOX_CONFIG");
  });
});

describe("pilot ops shell scripts on this branch", () => {
  it.each(["pending.sh", "review.sh"])("%s refuses to run and exits 1", (name) => {
    const result = spawnSync("bash", [dir + name, "ABC-DEF", "recibido", "details"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
  });
});
