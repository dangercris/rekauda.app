import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./lib/fake-checkout";
import { parseJsonc } from "./lib/jsonc.mjs";
// @ts-expect-error plain .mjs module without types
import { runCloudWrangler } from "./lib/cloud-wrangler-core.mjs";
// @ts-expect-error plain .mjs module without types
import { buildSandboxSeedSql } from "./lib/cloud-sandbox-seed.mjs";

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

interface Call {
  bin: string;
  argv: string[];
  cwd: string;
  /** Content of the --file argument at the moment of the call (the wrapper deletes the temp file afterwards). */
  file?: string;
}

/** Runs the wrapper against a throwaway checkout with a fake spawn: real wrangler is never reachable. */
function setup(files: Record<string, string> = {}): { root: string; calls: Call[]; errors: string[]; run: (...args: string[]) => number } {
  const root = fakeCheckout("cloud-wrangler", { "wrangler.cloud.jsonc": readFileSync(new URL("../wrangler.cloud.example.jsonc", import.meta.url), "utf8"), ...files });
  roots.push(root);
  const calls: Call[] = [];
  const errors: string[] = [];
  const spawn = (bin: string, argv: string[], options: { cwd: string }) => {
    const fileIndex = argv.indexOf("--file");
    const file = fileIndex === -1 || !existsSync(argv[fileIndex + 1]!) ? undefined : readFileSync(argv[fileIndex + 1]!, "utf8");
    calls.push(file === undefined ? { bin, argv, cwd: options.cwd } : { bin, argv, cwd: options.cwd, file });
    return { status: Number(process.env.STUB_EXIT ?? 0) };
  };
  const log = { error: (m: string) => errors.push(String(m)), warn: () => undefined };
  return { root, calls, errors, run: (...args) => runCloudWrangler(args, { root: root + "/", bin: "fake-wrangler", viteBin: "fake-vite", spawn, log, now: () => "2026-11-26T00:00:00.000Z" }) as number };
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


// Sandbox: the only path to --remote. Every fixture value is invented.
const SANDBOX_DB_ID = "99999999-aaaa-bbbb-cccc-888888888888";
const pilotFile = (d1Id = "11111111-aaaa-bbbb-cccc-222222222222") => JSON.stringify({ workers: ["fixture-pilot-worker"], d1Ids: [d1Id], buckets: ["fixture-pilot-bucket"] });
const PILOT_FILE = pilotFile();
const sandboxConfig = (patch: Record<string, unknown> = {}): string => {
  const example = parseJsonc(readFileSync(new URL("../wrangler.sandbox.example.jsonc", import.meta.url), "utf8"));
  return JSON.stringify({ ...example, d1_databases: [{ ...example.d1_databases[0], database_id: SANDBOX_DB_ID }], ...patch });
};
const sandboxSetup = (files: Record<string, string> = {}) => setup({ "wrangler.sandbox.jsonc": sandboxConfig(), ".pilot-resources.json": PILOT_FILE, ...files });
const SANDBOX_CONFIG = ["--config", "wrangler.sandbox.jsonc"];
const WORKERS = ["rekauda-sandbox-a", "rekauda-sandbox-b"];

describe("cloud-wrangler: sandbox subcommands", () => {
  it("sandbox:migrate applies migrations to the remote sandbox D1 with the fixed sandbox config", () => {
    const { calls, run } = sandboxSetup();
    expect(run("sandbox:migrate")).toBe(0);
    expect(calls.map((c) => c.argv)).toEqual([["d1", "migrations", "apply", "DB", "--remote", ...SANDBOX_CONFIG]]);
  });

  it("sandbox:seed runs a generated seed file with d1 execute --remote, then removes it", () => {
    const { calls, run } = sandboxSetup();
    expect(run("sandbox:seed")).toBe(0);
    expect(calls).toHaveLength(1);
    const argv = calls[0]!.argv;
    const file = argv[argv.indexOf("--file") + 1]!;
    expect(argv).toEqual(["d1", "execute", "DB", "--remote", "--file", file, ...SANDBOX_CONFIG]);
    expect(file.startsWith(tmpdir()) || file.includes("/.wrangler/")).toBe(true);
    expect(calls[0]!.file).toBe(buildSandboxSeedSql({ workers: WORKERS, rootDomain: "example-sub.workers.dev", now: "2026-11-26T00:00:00.000Z" }));
    expect(existsSync(file)).toBe(false);
  });

  it("sandbox:deploy builds once, then deploys once per worker with --name", () => {
    const { calls, run } = sandboxSetup();
    expect(run("sandbox:deploy")).toBe(0);
    expect(calls.map((c) => [c.bin, c.argv])).toEqual([
      ["fake-vite", ["build"]],
      ...WORKERS.map((w) => ["fake-wrangler", ["deploy", ...SANDBOX_CONFIG, "--name", w]]),
    ]);
  });

  it("sandbox:status lists deployments read-only per worker", () => {
    const { calls, run } = sandboxSetup();
    expect(run("sandbox:status")).toBe(0);
    expect(calls.map((c) => c.argv)).toEqual(WORKERS.map((w) => ["deployments", "list", ...SANDBOX_CONFIG, "--name", w]));
  });

  it("stops deploying after the first failing step and returns its status", () => {
    const { calls, run } = sandboxSetup();
    process.env.STUB_EXIT = "4";
    try {
      expect(run("sandbox:deploy")).toBe(4);
    } finally {
      delete process.env.STUB_EXIT;
    }
    expect(calls).toHaveLength(1);
  });

  it("never adds --remote to the local subcommands", () => {
    const { calls, run } = sandboxSetup();
    run("dev");
    run("d1", "migrations", "apply", "DB");
    run("types");
    expect(calls.flatMap((c) => c.argv)).not.toContain("--remote");
  });
});

describe("cloud-wrangler: sandbox refusals (nothing is ever spawned)", () => {
  const SUBS = ["sandbox:migrate", "sandbox:seed", "sandbox:deploy", "sandbox:status"];

  it.each(SUBS)("%s refuses when no real pilot data is known", (sub) => {
    const { calls, errors, run } = setup({ "wrangler.sandbox.jsonc": sandboxConfig() });
    expect(run(sub)).toBe(1);
    expect(errors.join("\n")).toContain("REFUSED pilot");
    expect(calls).toEqual([]);
  });

  it.each(SUBS)("%s refuses a config that violates the sandbox rules", (sub) => {
    const { calls, errors, run } = sandboxSetup({ "wrangler.sandbox.jsonc": sandboxConfig({ routes: [{ pattern: "x.example.net/*" }] }) });
    expect(run(sub)).toBe(1);
    expect(errors.join("\n")).toContain("REFUSED routes");
    expect(calls).toEqual([]);
  });

  it.each(SUBS)("%s refuses the untouched example (placeholder D1 id)", (sub) => {
    const { calls, run } = sandboxSetup({ "wrangler.sandbox.jsonc": readFileSync(new URL("../wrangler.sandbox.example.jsonc", import.meta.url), "utf8") });
    expect(run(sub)).toBe(1);
    expect(calls).toEqual([]);
  });

  it.each(SUBS)("%s refuses a resource shared with the pilot, without printing it", (sub) => {
    const { calls, errors, run } = sandboxSetup({ ".pilot-resources.json": pilotFile(SANDBOX_DB_ID) });
    expect(run(sub)).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join("\n")).not.toContain(SANDBOX_DB_ID);
  });

  it.each(SUBS)("%s does not spawn when the sandbox config is missing", (sub) => {
    const { calls, run } = setup({ ".pilot-resources.json": PILOT_FILE });
    try {
      expect(run(sub)).toBe(1);
    } catch {
      // a throw is also a refusal: the CLI entry turns it into exit 1
    }
    expect(calls).toEqual([]);
  });

  it.each(SUBS)("%s rejects passthrough flags and any extra argument", (sub) => {
    for (const extra of [["--remote"], ["--config", "wrangler.jsonc"], ["-c", "x"], ["--env", "prod"], ["--env-file", "x"], ["--persist-to", "x"], ["--name", "other"], ["extra"]]) {
      const { calls, errors, run } = sandboxSetup();
      expect(run(sub, ...extra), extra.join(" ")).toBe(1);
      expect(errors.join("\n")).toContain("REFUSED");
      expect(calls).toEqual([]);
    }
  });

  it("still rejects --remote on the local subcommands", () => {
    for (const args of [["dev", "--remote"], ["d1", "execute", "DB", "--remote"], ["types", "--remote"]]) {
      const { calls, run } = sandboxSetup();
      expect(run(...args)).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  it("does not use the cloud config for sandbox subcommands", () => {
    const { calls, run } = setup({ ".pilot-resources.json": PILOT_FILE, "wrangler.cloud.jsonc": sandboxConfig() });
    try {
      run("sandbox:migrate");
    } catch {
      // missing wrangler.sandbox.jsonc: refused
    }
    expect(calls).toEqual([]);
  });
});

describe("cloud-wrangler: sandbox spawn environment (L1)", () => {
  it("spawns with a scrubbed env: keeps credentials and PATH, drops CLOUDFLARE_ENV and WRANGLER_*", () => {
    const root = fakeCheckout("cloud-wrangler-env", { "wrangler.sandbox.jsonc": sandboxConfig(), ".pilot-resources.json": PILOT_FILE });
    roots.push(root);
    const seen: Record<string, string | undefined>[] = [];
    const spawn = (_bin: string, _argv: string[], options: { env?: Record<string, string | undefined> }) => {
      seen.push(options.env ?? { MISSING: "env" });
      return { status: 0 };
    };
    const env = { PATH: "/bin", HOME: "/home/x", TMPDIR: "/tmp", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", NODE_ENV: "production", CLOUDFLARE_ENV: "prod", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG: "debug", CLOUDFLARE_API_BASE_URL: "https://x", FOO: "bar" };
    const log = { error: () => undefined, warn: () => undefined };
    for (const sub of ["sandbox:migrate", "sandbox:seed", "sandbox:deploy", "sandbox:status"]) {
      seen.length = 0;
      expect(runCloudWrangler([sub], { root: root + "/", bin: "w", viteBin: "v", spawn, log, env })).toBe(0);
      expect(seen.length).toBeGreaterThan(0);
      for (const e of seen) expect(e).toEqual({ PATH: "/bin", HOME: "/home/x", TMPDIR: "/tmp", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", NODE_ENV: "production" });
    }
  });
});

describe("cloud-wrangler: the guard runs again before EVERY remote spawn (L2)", () => {
  /** Runs sub; the fake spawn calls `mutate` after its first call. Returns the calls and the status. */
  function mutating(sub: string, mutate: (root: string) => void) {
    const root = fakeCheckout("cloud-wrangler-mutate", { "wrangler.sandbox.jsonc": sandboxConfig(), ".pilot-resources.json": PILOT_FILE });
    roots.push(root);
    const calls: string[][] = [];
    const errors: string[] = [];
    const spawn = (_bin: string, argv: string[]) => {
      calls.push(argv);
      if (calls.length === 1) mutate(root);
      return { status: 0 };
    };
    const log = { error: (m: string) => errors.push(String(m)), warn: () => undefined };
    const status = runCloudWrangler([sub], { root: root + "/", bin: "w", viteBin: "v", spawn, log, env: {} }) as number;
    return { calls, errors, status };
  }
  const write = (root: string, patch: Record<string, unknown>) => writeFileSync(join(root, "wrangler.sandbox.jsonc"), sandboxConfig(patch));

  it("sandbox:deploy stops when the config gains a route after the build", () => {
    const { calls, errors, status } = mutating("sandbox:deploy", (root) => write(root, { routes: [{ pattern: "x.example.net/*" }] }));
    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
    expect(errors.join("\n")).toContain("REFUSED");
  });

  it("sandbox:deploy stops when the config changes even to another valid one", () => {
    const { calls, status } = mutating("sandbox:deploy", (root) => write(root, { d1_databases: [{ ...parseJsonc(sandboxConfig()).d1_databases[0], database_name: "rekauda-sandbox-other" }] }));
    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("sandbox:deploy stops when the pilot reference file changes to include the sandbox D1 id", () => {
    const { calls, status } = mutating("sandbox:deploy", (root) => writeFileSync(join(root, ".pilot-resources.json"), pilotFile(SANDBOX_DB_ID)));
    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("sandbox:deploy still deploys everything when nothing changes", () => {
    const { calls, status } = mutating("sandbox:deploy", () => undefined);
    expect(status).toBe(0);
    expect(calls).toHaveLength(3);
  });

  it("sandbox:status stops between workers when the config becomes invalid", () => {
    const { calls, status } = mutating("sandbox:status", (root) => write(root, { workers_dev: false }));
    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

describe("cloud-wrangler: duplicate keys in wrangler.sandbox.jsonc", () => {
  it("refuses a duplicated name without spawning", () => {
    const text = sandboxConfig().replace(/^\{/, '{ "name": "rekauda-sandbox-evil", ');
    const { calls, run } = setup({ "wrangler.sandbox.jsonc": text, ".pilot-resources.json": PILOT_FILE });
    try {
      expect(run("sandbox:deploy")).toBe(1);
    } catch {
      // a throw is also a refusal
    }
    expect(calls).toEqual([]);
  });
});
