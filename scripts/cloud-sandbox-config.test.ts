import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./lib/fake-checkout";
import { parseJsonc } from "./lib/jsonc.mjs";

const repo = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "sandbox-config-"));
const roots: string[] = [];
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
});

const exampleText = readFileSync(repo + "wrangler.sandbox.example.jsonc", "utf8");
const example = parseJsonc(exampleText);
const cloudExample = parseJsonc(readFileSync(repo + "wrangler.cloud.example.jsonc", "utf8"));

/** The example with a non-placeholder D1 id, as the owner would fill it in. Invented value. */
const filled = JSON.stringify({ ...example, d1_databases: [{ ...example.d1_databases[0], database_id: "99999999-aaaa-bbbb-cccc-888888888888" }] });
const PILOT = JSON.stringify({ workers: ["fixture-pilot-worker"], d1Ids: ["11111111-aaaa-bbbb-cccc-222222222222"], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"] });

function checkout(files: Record<string, string>): string {
  const root = fakeCheckout("sandbox-guard", files);
  roots.push(root);
  return root;
}
const guard = (root: string, ...args: string[]) => spawnSync(process.execPath, [join(root, "scripts/cloud-guard.mjs"), ...args], { encoding: "utf8" });
const output = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

describe("wrangler.sandbox.example.jsonc", () => {
  it("is a workers.dev-only multi tenant config for two sandbox workers", () => {
    expect(example.name).toContain("sandbox");
    expect(example.workers_dev).toBe(true);
    expect(example.preview_urls).toBe(false);
    expect("routes" in example || "route" in example).toBe(false);
    expect(example.vars).toMatchObject({ SANDBOX: "true", TENANCY: "multi" });
    expect(example.vars.ROOT_DOMAIN.endsWith(".workers.dev")).toBe(true);
    expect(typeof example.vars.INBOUND_DOMAIN).toBe("string");
    expect(example.vars.SANDBOX_WORKERS).toHaveLength(2);
    expect(example.vars.SANDBOX_WORKERS).toContain(example.name);
    expect(example.migrations_dir ?? example.d1_databases[0].migrations_dir).toBe("migrations-cloud");
  });

  it("declares its own D1 and R2 and no mail bindings", () => {
    expect(example.d1_databases[0].binding).toBe("DB");
    expect(example.d1_databases[0].database_name).toContain("sandbox");
    expect(example.r2_buckets.map((b: { binding: string }) => b.binding)).toEqual(["RECEIPTS"]);
    expect(example.r2_buckets[0].bucket_name).toContain("sandbox");
    expect(example.send_email).toBeUndefined();
    expect(example.assets.binding).toBe("ASSETS");
    expect(example.assets.run_worker_first).toEqual(cloudExample.assets.run_worker_first);
    expect(example.observability).toEqual({ enabled: true });
  });

  it("uses ratelimit namespace ids distinct from the cloud and pilot examples", () => {
    const ids = (config: { ratelimits: { namespace_id: string }[] }) => config.ratelimits.map((r) => r.namespace_id);
    const pilotExample = parseJsonc(readFileSync(repo + "wrangler.example.jsonc", "utf8"));
    for (const id of ids(example)) {
      expect(ids(cloudExample)).not.toContain(id);
      expect(ids(pilotExample)).not.toContain(id);
    }
  });

  it("holds no account_id and keeps the database id as a placeholder", () => {
    expect(example.account_id).toBeUndefined();
    expect(example.d1_databases[0].database_id).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("uses the rekauda-sandbox- prefix for every name", () => {
    for (const name of [example.name, ...example.vars.SANDBOX_WORKERS, example.d1_databases[0].database_name, example.r2_buckets[0].bucket_name]) expect(name.startsWith("rekauda-sandbox-")).toBe(true);
    expect(example.main).toBe(cloudExample.main);
  });

  it("documents the .pilot-resources.json shape with its category keys", () => {
    for (const key of ["workers", "d1Ids", "buckets", "ratelimitIds"]) expect(exampleText).toContain(key);
  });

  it("is gitignored as wrangler.sandbox.jsonc", () => {
    expect(readFileSync(repo + ".gitignore", "utf8").split("\n")).toContain("wrangler.sandbox.jsonc");
  });
});

describe("ensure-config and the sandbox config", () => {
  function ensureCheckout(name: string): string {
    const root = join(tmp, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    copyFileSync(repo + "scripts/ensure-config.mjs", join(root, "scripts/ensure-config.mjs"));
    for (const file of ["rekauda.config.example.ts", "wrangler.example.jsonc", "wrangler.cloud.example.jsonc", "wrangler.sandbox.example.jsonc"]) copyFileSync(repo + file, join(root, file));
    return root;
  }
  const ensure = (root: string) => spawnSync(process.execPath, [join(root, "scripts/ensure-config.mjs")], { encoding: "utf8" });

  it("creates wrangler.sandbox.jsonc from the example when it is missing", () => {
    const root = ensureCheckout("missing");
    ensure(root);
    expect(readFileSync(join(root, "wrangler.sandbox.jsonc"), "utf8")).toBe(exampleText);
  });

  it("never overwrites an existing wrangler.sandbox.jsonc", () => {
    const root = ensureCheckout("existing");
    writeFileSync(join(root, "wrangler.sandbox.jsonc"), '{ "name": "mine" }');
    ensure(root);
    expect(readFileSync(join(root, "wrangler.sandbox.jsonc"), "utf8")).toBe('{ "name": "mine" }');
    expect(existsSync(join(root, "wrangler.cloud.jsonc"))).toBe(true);
  });
});

describe("cloud-guard CLI --sandbox", () => {
  const base = { "wrangler.sandbox.jsonc": filled, ".pilot-resources.json": PILOT };

  it("exits 0 for a filled sandbox config when real pilot data is known", () => {
    const result = guard(checkout(base), "--sandbox");
    expect(output(result)).toContain("OK");
    expect(result.status).toBe(0);
  });

  it("refuses the untouched example (placeholder D1 id)", () => {
    const result = guard(checkout({ "wrangler.sandbox.jsonc": exampleText, ".pilot-resources.json": PILOT }), "--sandbox");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED d1_databases.database_id");
  });

  it("refuses when no real pilot data is known and says why", () => {
    const result = guard(checkout({ "wrangler.sandbox.jsonc": filled }), "--sandbox");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED pilot");
  });

  it("refuses a D1 id equal to the pilot's without printing it", () => {
    const withPilotId = JSON.stringify({ ...JSON.parse(filled), d1_databases: [{ ...example.d1_databases[0], database_id: "11111111-aaaa-bbbb-cccc-222222222222" }] });
    const result = guard(checkout({ ...base, "wrangler.sandbox.jsonc": withPilotId }), "--sandbox");
    expect(result.status).toBe(1);
    expect(output(result)).not.toContain("11111111-aaaa-bbbb-cccc-222222222222");
  });

  it("does not accept --config with --sandbox, nor sandbox mode for the cloud file", () => {
    const root = checkout({ ...base, "wrangler.cloud.jsonc": filled });
    expect(guard(root, "--sandbox", "--config", "wrangler.cloud.jsonc").status).toBe(1);
  });

  it("keeps refusing a plain --remote (cloud config) and --local behaviour", () => {
    const root = checkout({ ...base, "wrangler.cloud.jsonc": readFileSync(repo + "wrangler.cloud.example.jsonc", "utf8") });
    expect(guard(root, "--remote").status).toBe(1);
    expect(guard(root, "--local").status).toBe(0);
  });

  it("refuses a partial .pilot-resources.json (names only) even with a clean config", () => {
    const result = guard(checkout({ "wrangler.sandbox.jsonc": filled, ".pilot-resources.json": JSON.stringify({ names: ["fixture-pilot-worker"] }) }), "--sandbox");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED pilot");
    expect(output(result)).not.toContain("fixture-pilot-worker");
  });

  it.each([
    ["name", `{ "name": "rekauda-sandbox-evil", `],
    ["d1_databases", `{ "d1_databases": [], `],
    ["vars", `{ "vars": {}, `],
  ])("refuses a duplicate top-level key %s (last-wins ambiguity)", (_key, prefix) => {
    const text = filled.replace(/^\{/, prefix);
    const result = guard(checkout({ "wrangler.sandbox.jsonc": text, ".pilot-resources.json": PILOT }), "--sandbox");
    expect(result.status).toBe(1);
  });

  it("fails closed when wrangler.sandbox.jsonc is missing", () => {
    const result = guard(checkout({ ".pilot-resources.json": PILOT }), "--sandbox");
    expect(result.status).toBe(1);
  });
});
