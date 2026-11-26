import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./lib/fake-checkout";
// @ts-expect-error plain .mjs module without types
import { runCloudWrangler } from "./lib/cloud-wrangler-core.mjs";

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

interface Call {
  bin: string;
  argv: string[];
  cwd: string;
}

/** Runs the wrapper against a throwaway checkout with a fake spawn: real wrangler is never reachable. */
function setup(files: Record<string, string> = {}): { root: string; calls: Call[]; errors: string[]; run: (...args: string[]) => number } {
  const root = fakeCheckout("cloud-wrangler", { "wrangler.cloud.jsonc": readFileSync(new URL("../wrangler.cloud.example.jsonc", import.meta.url), "utf8"), ...files });
  roots.push(root);
  const calls: Call[] = [];
  const errors: string[] = [];
  const spawn = (bin: string, argv: string[], options: { cwd: string }) => {
    calls.push({ bin, argv, cwd: options.cwd });
    return { status: Number(process.env.STUB_EXIT ?? 0) };
  };
  const log = { error: (m: string) => errors.push(String(m)), warn: () => undefined };
  return { root, calls, errors, run: (...args) => runCloudWrangler(args, { root: root + "/", bin: "fake-wrangler", spawn, log }) as number };
}
const FIXED = ["--config", "wrangler.cloud.jsonc", "--persist-to", ".wrangler/state-cloud"];

describe("cloud-wrangler: what it runs", () => {
  it("runs dev with the fixed cloud config and its own persistence dir, from the repo root", () => {
    const { root, calls, run } = setup();
    expect(run("dev", "--port", "8799")).toBe(0);
    expect(calls).toEqual([{ bin: "fake-wrangler", argv: ["dev", "--port", "8799", ...FIXED], cwd: root + "/" }]);
  });

  it("forces --local for d1 commands", () => {
    const { calls, run } = setup();
    run("d1", "migrations", "apply", "DB");
    expect(calls[0]?.argv).toEqual(["d1", "migrations", "apply", "DB", "--local", ...FIXED]);
  });

  it("does not duplicate --local", () => {
    const { calls, run } = setup();
    run("d1", "execute", "DB", "--local");
    expect(calls[0]?.argv).toEqual(["d1", "execute", "DB", "--local", ...FIXED]);
  });

  it("runs types with the cloud config but without a persistence dir", () => {
    const { calls, run } = setup();
    run("types");
    expect(calls[0]?.argv).toEqual(["types", "--config", "wrangler.cloud.jsonc"]);
  });

  it("propagates the exit status of wrangler", () => {
    const { run } = setup();
    process.env.STUB_EXIT = "3";
    try {
      expect(run("dev")).toBe(3);
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
    ["--env-file", ".env.prod"],
    ["--env-file=.env.prod"],
    ["--persist-to", "elsewhere"],
    ["--persist-to=elsewhere"],
    ["--local=false"],
  ])("rejects the pass-through flag %j", (...flag) => {
    const { calls, errors, run } = setup();
    expect(run("dev", ...flag)).toBe(1);
    expect(errors.join("\n")).toContain("REFUSED");
    expect(calls).toEqual([]);
  });

  it.each([["deploy"], ["secret", "put", "X"], ["r2", "object", "get", "a/b"], ["versions", "upload"], ["delete"], []])("rejects the subcommand %j", (...args) => {
    const { calls, run } = setup();
    expect(run(...args)).toBe(1);
    expect(calls).toEqual([]);
  });

  it.each([["d1", "create", "x"], ["d1", "delete", "DB"], ["d1", "export", "DB"], ["d1", "time-travel", "restore", "DB"], ["d1"]])("rejects the d1 action %j", (...args) => {
    const { calls, run } = setup();
    expect(run(...args)).toBe(1);
    expect(calls).toEqual([]);
  });

  it.each([["d1", "execute", "DB", "--file", "x.sql"], ["d1", "migrations", "list", "DB"]])("allows the d1 action %j", (...args) => {
    const { calls, run } = setup();
    expect(run(...args)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("blocks when the guard finds a pilot resource in the cloud config", () => {
    const { calls, errors, run } = setup({
      "wrangler.jsonc": '{ "name": "fixture-pilot-worker" }',
      "wrangler.cloud.jsonc": '{ "name": "fixture-pilot-worker", "d1_databases": [{ "migrations_dir": "migrations-cloud" }] }',
    });
    expect(run("dev")).toBe(1);
    expect(errors.join("\n")).toContain("REFUSED name:");
    expect(calls).toEqual([]);
  });
});

describe("cloud-wrangler CLI: the binary cannot be redirected from the environment", () => {
  it("ignores CLOUD_WRANGLER_BIN even with VITEST set and always uses the checkout wrangler", () => {
    const root = fakeCheckout("cloud-wrangler-cli", { "wrangler.cloud.jsonc": readFileSync(new URL("../wrangler.cloud.example.jsonc", import.meta.url), "utf8") });
    roots.push(root);
    writeFileSync(join(root, "stub.mjs"), 'console.log("STUB-RAN");');
    const result = spawnSync(process.execPath, [join(root, "scripts/cloud-wrangler.mjs"), "dev"], {
      encoding: "utf8",
      env: { ...process.env, CLOUD_WRANGLER_BIN: join(root, "stub.mjs"), VITEST: "1" },
    });
    expect(String(result.stdout) + String(result.stderr)).not.toContain("STUB-RAN");
    expect(result.status).not.toBe(0);
  });

  it("no longer reads CLOUD_WRANGLER_BIN anywhere in the scripts", () => {
    for (const file of ["cloud-wrangler.mjs", "lib/cloud-wrangler-core.mjs"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toContain("CLOUD_WRANGLER_BIN");
    }
  });
});

