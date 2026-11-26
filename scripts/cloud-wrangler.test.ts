import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./lib/fake-checkout";

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

// The stub replaces wrangler: it prints its argv and cwd and exits with STUB_EXIT. Real wrangler is never run.
const STUB = `console.log("STUB " + JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })); process.exit(Number(process.env.STUB_EXIT ?? 0));`;

function setup(files: Record<string, string> = {}): { root: string; wrangler: (...args: string[]) => ReturnType<typeof spawnSync> } {
  const root = fakeCheckout("cloud-wrangler", { "wrangler.cloud.jsonc": readFileSync(new URL("../wrangler.cloud.example.jsonc", import.meta.url), "utf8"), ...files });
  roots.push(root);
  writeFileSync(join(root, "stub.mjs"), STUB);
  const wrangler = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "scripts/cloud-wrangler.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, CLOUD_WRANGLER_BIN: join(root, "stub.mjs"), STUB_EXIT: process.env.STUB_EXIT ?? "0" },
    });
  return { root, wrangler };
}
const stubCall = (stdout: string): { argv: string[]; cwd: string } => JSON.parse(stdout.split("STUB ")[1] ?? "null");
const text = (r: { stdout?: unknown; stderr?: unknown }) => String(r.stdout) + String(r.stderr);
const FIXED = ["--config", "wrangler.cloud.jsonc", "--persist-to", ".wrangler/state-cloud"];

describe("cloud-wrangler: what it runs", () => {
  it("runs dev with the fixed cloud config and its own persistence dir, from the repo root", () => {
    const { root, wrangler } = setup();
    const result = wrangler("dev", "--port", "8799");
    expect(result.status).toBe(0);
    const call = stubCall(String(result.stdout));
    expect(call.argv).toEqual(["dev", "--port", "8799", ...FIXED]);
    expect(call.cwd.endsWith(root.split("/").pop()!)).toBe(true);
  });

  it("forces --local for d1 commands", () => {
    const { wrangler } = setup();
    expect(stubCall(String(wrangler("d1", "migrations", "apply", "DB").stdout)).argv).toEqual(["d1", "migrations", "apply", "DB", "--local", ...FIXED]);
  });

  it("does not duplicate --local", () => {
    const { wrangler } = setup();
    expect(stubCall(String(wrangler("d1", "execute", "DB", "--local").stdout)).argv).toEqual(["d1", "execute", "DB", "--local", ...FIXED]);
  });

  it("runs types with the cloud config but without a persistence dir", () => {
    const { wrangler } = setup();
    expect(stubCall(String(wrangler("types").stdout)).argv).toEqual(["types", "--config", "wrangler.cloud.jsonc"]);
  });

  it("propagates the exit status of wrangler", () => {
    const { wrangler } = setup();
    process.env.STUB_EXIT = "3";
    try {
      expect(wrangler("dev").status).toBe(3);
    } finally {
      delete process.env.STUB_EXIT;
    }
  });
});

describe("cloud-wrangler: what it refuses (wrangler is never reached)", () => {
  it.each([
    ["--remote"],
    ["--remote=true"],
    ["-c", "other.jsonc"],
    ["-cother.jsonc"],
    ["--config", "wrangler.jsonc"],
    ["--config=wrangler.jsonc"],
    ["-e", "prod"],
    ["--env", "prod"],
    ["--env=prod"],
    ["--persist-to", "elsewhere"],
    ["--persist-to=elsewhere"],
    ["--local=false"],
  ])("rejects the pass-through flag %j", (...flag) => {
    const { wrangler } = setup();
    const result = wrangler("dev", ...flag);
    expect(result.status).toBe(1);
    expect(text(result)).toContain("REFUSED");
    expect(text(result)).not.toContain("STUB");
  });

  it.each([["deploy"], ["secret", "put", "X"], ["r2", "object", "get", "a/b"], ["versions", "upload"], ["delete"], []])("rejects the subcommand %j", (...args) => {
    const { wrangler } = setup();
    const result = wrangler(...args);
    expect(result.status).toBe(1);
    expect(text(result)).not.toContain("STUB");
  });

  it("blocks when the guard finds a pilot resource in the cloud config", () => {
    const { wrangler } = setup({
      "wrangler.jsonc": '{ "name": "fixture-pilot-worker" }',
      "wrangler.cloud.jsonc": '{ "name": "fixture-pilot-worker", "d1_databases": [{ "migrations_dir": "migrations-cloud" }] }',
    });
    const result = wrangler("dev");
    expect(result.status).toBe(1);
    expect(text(result)).toContain("REFUSED name:");
    expect(text(result)).not.toContain("STUB");
  });
});
