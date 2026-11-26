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
const MENTIONS_REMOTE_FLAG = ["cloud-guard.mjs", "cloud-wrangler.mjs"];
const INVOKES_WRANGLER = /bin\/wrangler|\bwrangler\s+(d1|dev|deploy|r2|secret|types|versions|kv|delete)\b/;

describe("scripts/ safety scan", () => {
  it("finds the scripts to scan", () => {
    expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(["cloud-wrangler.mjs", "pending.sh", "review.sh"]));
  });

  it.each(sources)("$name never uses --remote outside the guard and the wrapper", ({ name, text }) => {
    if (!MENTIONS_REMOTE_FLAG.includes(name)) expect(text).not.toContain("--remote");
  });

  it.each(sources)("$name invokes wrangler only through cloud-wrangler.mjs", ({ name, text }) => {
    if (name !== "cloud-wrangler.mjs") expect(INVOKES_WRANGLER.test(text)).toBe(false);
  });
});

describe("pilot ops shell scripts on this branch", () => {
  it.each(["pending.sh", "review.sh"])("%s refuses to run and exits 1", (name) => {
    const result = spawnSync("bash", [dir + name, "ABC-DEF", "recibido", "details"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
  });
});
