import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./lib/fake-checkout";
import { parseJsonc } from "./lib/jsonc.mjs";

const repo = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "ensure-config-"));
const roots: string[] = [];
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
});

/** Builds a throwaway checkout holding only what ensure-config needs, so the real repo files are never touched. */
function ensureCheckout(name: string): string {
  const root = join(tmp, name);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(repo + "scripts/ensure-config.mjs", join(root, "scripts/ensure-config.mjs"));
  for (const file of ["rekauda.config.example.ts", "wrangler.example.jsonc", "wrangler.cloud.example.jsonc", "wrangler.sandbox.example.jsonc"]) copyFileSync(repo + file, join(root, file));
  return root;
}
const ensure = (root: string) => spawnSync(process.execPath, [join(root, "scripts/ensure-config.mjs")], { encoding: "utf8" });

describe("wrangler.cloud.example.jsonc", () => {
  const example = parseJsonc(readFileSync(repo + "wrangler.cloud.example.jsonc", "utf8"));

  it("targets migrations-cloud and the multi tenancy mode", () => {
    expect(example.d1_databases[0].migrations_dir).toBe("migrations-cloud");
    expect(example.vars.TENANCY).toBe("multi");
    expect(Object.keys(example.vars)).toEqual(expect.arrayContaining(["ROOT_DOMAIN", "INBOUND_DOMAIN"]));
  });

  it("declares the cloud bindings", () => {
    expect(example.d1_databases[0].binding).toBe("DB");
    expect(example.r2_buckets.map((b: { binding: string }) => b.binding).sort()).toEqual(["MAIL_ARCHIVE", "RECEIPTS"]);
    expect(example.assets.binding).toBe("ASSETS");
    expect(example.send_email[0].name).toBe("SEND_EMAIL");
  });

  it("passes the guard in local mode and is refused for remote", () => {
    const root = fakeCheckout("example-guard", { "wrangler.cloud.jsonc": readFileSync(repo + "wrangler.cloud.example.jsonc", "utf8") });
    roots.push(root);
    const guard = (mode: string) => spawnSync(process.execPath, [join(root, "scripts/cloud-guard.mjs"), mode], { encoding: "utf8" });
    expect(guard("--local").status).toBe(0);
    expect(guard("--remote").status).toBe(1);
  });
});

describe("ensure-config and the cloud config", () => {
  it("creates wrangler.cloud.jsonc from the example when it is missing", () => {
    const root = ensureCheckout("missing");
    ensure(root);
    expect(readFileSync(join(root, "wrangler.cloud.jsonc"), "utf8")).toBe(readFileSync(join(root, "wrangler.cloud.example.jsonc"), "utf8"));
  });

  it("never overwrites an existing wrangler.cloud.jsonc", () => {
    const root = ensureCheckout("existing");
    writeFileSync(join(root, "wrangler.cloud.jsonc"), '{ "name": "mine" }');
    ensure(root);
    expect(readFileSync(join(root, "wrangler.cloud.jsonc"), "utf8")).toBe('{ "name": "mine" }');
    expect(existsSync(join(root, "wrangler.jsonc"))).toBe(true);
  });

  it("gitignores wrangler.cloud.jsonc and .pilot-resources.json", () => {
    const lines = readFileSync(repo + ".gitignore", "utf8").split("\n");
    expect(lines).toContain("wrangler.cloud.jsonc");
    expect(lines).toContain(".pilot-resources.json");
  });
});
