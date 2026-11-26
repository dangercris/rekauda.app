import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./lib/fake-checkout";

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const PILOT_NAME = "fixture-pilot-worker";
const PILOT_DB_ID = "55555555-aaaa-bbbb-cccc-666666666666";
const cloudConfig = (name: string, dbId = "99999999-aaaa-bbbb-cccc-777777777777"): string => `{
  // fixture with an invented name
  "name": "${name}",
  "d1_databases": [{ "binding": "DB", "database_name": "${name}-db", "database_id": "${dbId}", "migrations_dir": "migrations-cloud", }],
}`;

function checkout(files: Record<string, string> = {}): string {
  const root = fakeCheckout("cloud-guard", { "wrangler.cloud.jsonc": cloudConfig("cloud-fresh"), ...files });
  roots.push(root);
  return root;
}
const guard = (root: string, ...args: string[]) => spawnSync(process.execPath, [join(root, "scripts/cloud-guard.mjs"), ...args], { encoding: "utf8" });
const output = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

describe("cloud-guard CLI", () => {
  it("exits 0 with a warning, and no ids, when no real pilot data is known", () => {
    const result = guard(checkout(), "--local");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("WARNING");
    expect(result.stderr).toContain("no real pilot data");
  });

  it("exits 0 without a warning when real pilot data is known and the config is distinct", () => {
    const result = guard(checkout({ "wrangler.jsonc": `{ "name": "${PILOT_NAME}" }` }), "--local");
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("WARNING");
  });

  it("refuses a pilot name found in the local wrangler.jsonc, naming the field only", () => {
    const result = guard(checkout({ "wrangler.jsonc": `{ "name": "${PILOT_NAME}" }`, "wrangler.cloud.jsonc": cloudConfig(PILOT_NAME) }), "--local");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED name:");
    expect(output(result)).not.toContain(PILOT_NAME);
  });

  it("refuses an id listed in .pilot-resources.json and never prints it", () => {
    const root = checkout({ ".pilot-resources.json": JSON.stringify({ ids: [PILOT_DB_ID] }), "wrangler.cloud.jsonc": cloudConfig("cloud-other", PILOT_DB_ID) });
    const result = guard(root, "--local");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED d1_databases.database_id:");
    expect(output(result)).not.toContain(PILOT_DB_ID);
  });

  it("refuses --remote unconditionally", () => {
    const result = guard(checkout({ "wrangler.jsonc": `{ "name": "${PILOT_NAME}" }` }), "--remote");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REFUSED mode:");
  });

  it.each([
    ["the cloud config is missing", { "wrangler.cloud.jsonc": "" }, "--local"],
    ["the cloud config does not parse", { "wrangler.cloud.jsonc": '{"name": ' }, "--local"],
    ["the pilot reference does not parse", { "wrangler.jsonc": "{" }, "--local"],
    ["the denylist file does not parse", { ".pilot-resources.json": "not json" }, "--local"],
    ["no mode flag is given", {}, "--config"],
  ])("fails closed when %s", (_label, files, flag) => {
    expect(guard(checkout(files), flag).status).toBe(1);
  });

  it("--refuse-branch says pilot ops run from main only and exits 1", () => {
    const result = guard(checkout(), "--refuse-branch");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pilot ops scripts run from main only");
    expect(result.stderr).toContain("deploy the pilot from main");
  });
});
