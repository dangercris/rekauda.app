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

// Production: the second remote family. Fixture values are invented; the config comes from the committed example.
const PROD_DB_ID = "55555555-aaaa-bbbb-cccc-444444444444";
const PROD_CONFIG = ["--config", "wrangler.production.jsonc"];
const PROD_ROOT = "colegio-demo.example.test";
const APEX_ROUTES = [{ pattern: `*.${PROD_ROOT}/*`, zone_name: PROD_ROOT }, { pattern: `${PROD_ROOT}/*`, zone_name: PROD_ROOT }];
const prodConfig = (patch: Record<string, unknown> = {}): string => {
  const example = parseJsonc(readFileSync(new URL("../wrangler.production.example.jsonc", import.meta.url), "utf8"));
  const ratelimits = example.ratelimits.map((r: any, i: number) => ({ ...r, namespace_id: String(7001 + i) }));
  return JSON.stringify({ ...example, d1_databases: [{ ...example.d1_databases[0], database_id: PROD_DB_ID }], ratelimits, ...patch });
};
const prodSetup = (files: Record<string, string> = {}) => setup({ "wrangler.production.jsonc": prodConfig(), ".pilot-resources.json": JSON.stringify({ workers: ["fixture-pilot-worker"], d1Ids: ["11111111-aaaa-bbbb-cccc-222222222222"], buckets: ["fixture-pilot-bucket"], ratelimitIds: ["4242"], productionRoot: PROD_ROOT }), ...files });
const PROD_PHRASES: Record<string, string> = { "prod:migrate": "MIGRATE PRODUCTION", "prod:deploy": "DEPLOY PRODUCTION", "prod:switch-apex": "SWITCH APEX" };

/** Same as setup().run but with an injected confirmation, an env and a recording log. */
function prodRun(root: string, calls: Call[], sub: string, { typed, env = {}, tty = true, args = [] as string[] }: { typed?: string; env?: Record<string, string>; tty?: boolean; args?: string[] } = {}) {
  const errors: string[] = [];
  const asked: string[] = [];
  const notes: string[] = [];
  const spawn = (bin: string, argv: string[], options: { cwd: string; env?: Record<string, string> }) => {
    calls.push({ bin, argv, cwd: options.cwd, ...(options.env ? { env: options.env } : {}) } as Call);
    return { status: 0 };
  };
  const confirm = (phrase: string) => {
    asked.push(phrase);
    return tty && typed === phrase;
  };
  const log = { error: (m: string) => errors.push(String(m)), warn: (m: string) => notes.push(String(m)) };
  const status = runCloudWrangler([sub, ...args], { root: root + "/", bin: "w", viteBin: "v", spawn, log, env, confirm }) as number;
  return { status, errors, asked, notes };
}

describe("cloud-wrangler: production subcommands", () => {
  it.each([
    ["prod:migrate", [["d1", "migrations", "apply", "DB", "--remote", ...PROD_CONFIG]]],
    ["prod:status", [["deployments", "list", ...PROD_CONFIG]]],
    ["prod:deploy", [["build"], ["deploy", ...PROD_CONFIG]]],
  ])("%s runs the exact argv after the typed phrase", (sub, argvs) => {
    const { root, calls } = prodSetup();
    const { status, asked } = prodRun(root, calls, sub, { typed: PROD_PHRASES[sub] });
    expect(status).toBe(0);
    expect(calls.map((c) => c.argv)).toEqual(argvs);
    expect(asked).toEqual(sub === "prod:status" ? [] : [PROD_PHRASES[sub]]);
  });

  it("prod:switch-apex deploys only when the apex entry is present and the phrase is typed", () => {
    const { root, calls } = prodSetup({ "wrangler.production.jsonc": prodConfig({ routes: APEX_ROUTES }) });
    expect(prodRun(root, calls, "prod:switch-apex", { typed: "SWITCH APEX" }).status).toBe(0);
    expect(calls.map((c) => c.argv)).toEqual([["build"], ["deploy", ...PROD_CONFIG]]);
  });

  it("prod:deploy with the apex entry present needs the SWITCH APEX phrase, never DEPLOY PRODUCTION", () => {
    const apexConfig = { "wrangler.production.jsonc": prodConfig({ routes: APEX_ROUTES }) };
    const refused = prodSetup(apexConfig);
    const wrong = prodRun(refused.root, refused.calls, "prod:deploy", { typed: "DEPLOY PRODUCTION" });
    expect([wrong.status, wrong.asked, refused.calls]).toEqual([1, ["SWITCH APEX"], []]);
    const ok = prodSetup(apexConfig);
    expect(prodRun(ok.root, ok.calls, "prod:deploy", { typed: "SWITCH APEX" }).status).toBe(0);
    expect(ok.calls.map((c) => c.argv)).toEqual([["build"], ["deploy", ...PROD_CONFIG]]);
  });

  it("prod:deploy without the apex entry keeps the DEPLOY PRODUCTION phrase", () => {
    const { root, calls } = prodSetup();
    expect(prodRun(root, calls, "prod:deploy", { typed: "SWITCH APEX" }).status).toBe(1);
    expect(prodRun(root, calls, "prod:deploy", { typed: "DEPLOY PRODUCTION" }).status).toBe(0);
  });

  it("shows the Worker name, account id and root before asking, and never the token", () => {
    const { root, calls } = prodSetup({ "wrangler.production.jsonc": prodConfig({ account_id: "acct-fixture-0001" }) });
    const { notes } = prodRun(root, calls, "prod:deploy", { typed: "DEPLOY PRODUCTION", env: { CLOUDFLARE_API_TOKEN: "tok-secret-1" } });
    const text = notes.join("\n");
    for (const shown of ["rekauda-cloud-app", "acct-fixture-0001", PROD_ROOT]) expect(text).toContain(shown);
    expect(text).not.toContain("tok-secret-1");
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("%s is not a production subcommand", (sub) => {
    const { root, calls } = prodSetup();
    expect(prodRun(root, calls, sub, { typed: "x" }).status).toBe(1);
    expect(calls).toEqual([]);
  });

  it("prod:switch-apex refuses a wrong phrase, no TTY, and a config without the apex entry", () => {
    const withApex = prodSetup({ "wrangler.production.jsonc": prodConfig({ routes: APEX_ROUTES }) });
    expect(prodRun(withApex.root, withApex.calls, "prod:switch-apex", { typed: "switch apex" }).status).toBe(1);
    expect(prodRun(withApex.root, withApex.calls, "prod:switch-apex", { typed: "SWITCH APEX", tty: false }).status).toBe(1);
    const plain = prodSetup();
    expect(prodRun(plain.root, plain.calls, "prod:switch-apex", { typed: "SWITCH APEX" }).status).toBe(1);
    expect([withApex.calls, plain.calls]).toEqual([[], []]);
  });

  it.each(["prod:migrate", "prod:deploy"])("%s spawns nothing without the exact phrase or a TTY", (sub) => {
    for (const opts of [{}, { typed: "yes" }, { typed: PROD_PHRASES[sub], tty: false }]) {
      const { root, calls } = prodSetup();
      expect(prodRun(root, calls, sub, opts).status).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  it.each(["prod:migrate", "prod:deploy", "prod:switch-apex", "prod:status"])("%s rejects passthrough flags and extra arguments", (sub) => {
    for (const args of [["--remote"], ["--config", "wrangler.jsonc"], ["-c", "x"], ["--name", "other"], ["--env", "prod"], ["extra"]]) {
      const { root, calls } = prodSetup();
      expect(prodRun(root, calls, sub, { typed: PROD_PHRASES[sub], args }).status, args.join(" ")).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  it.each(["secret", "delete", "prod:secret", "prod:delete", "prod:rollback-apex", "prod:d1"])("refuses the arbitrary subcommand %s", (sub) => {
    const { root, calls } = prodSetup();
    expect(prodRun(root, calls, sub, { typed: "x" }).status).toBe(1);
    expect(calls).toEqual([]);
  });

  it("refuses a pilot id, a missing config and a duplicated key without spawning", () => {
    const shared = prodSetup({ ".pilot-resources.json": JSON.stringify({ workers: ["w"], d1Ids: [PROD_DB_ID], buckets: ["b"], ratelimitIds: ["4242"], productionRoot: PROD_ROOT }) });
    const refused = prodRun(shared.root, shared.calls, "prod:status");
    expect(refused.status).toBe(1);
    expect(refused.errors.join("")).not.toContain(PROD_DB_ID);
    const missing = setup({ ".pilot-resources.json": "{}" });
    expect(() => prodRun(missing.root, missing.calls, "prod:status")).toThrow();
    const dup = prodSetup({ "wrangler.production.jsonc": prodConfig().replace(/^\{/, '{ "name": "rekauda-cloud-evil", ') });
    expect(() => prodRun(dup.root, dup.calls, "prod:status")).toThrow();
    expect([shared.calls, missing.calls, dup.calls]).toEqual([[], [], []]);
  });

  it("scrubs the spawn env before every production step", () => {
    const { root, calls } = prodSetup();
    const env = { PATH: "/bin", HOME: "/h", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ENV: "x", WRANGLER_LOG: "debug", FOO: "bar" };
    prodRun(root, calls, "prod:deploy", { typed: "DEPLOY PRODUCTION", env });
    expect(calls).toHaveLength(2);
    for (const c of calls) expect((c as any).env).toEqual({ PATH: "/bin", HOME: "/h", CLOUDFLARE_API_TOKEN: "t" });
  });

  it("rechecks before every spawn: a config change between steps is refused", () => {
    const { root, calls } = prodSetup();
    const spawn = (bin: string, argv: string[]) => {
      calls.push({ bin, argv, cwd: root });
      writeFileSync(join(root, "wrangler.production.jsonc"), prodConfig({ routes: APEX_ROUTES }));
      return { status: 0 };
    };
    const errors: string[] = [];
    const log = { error: (m: string) => errors.push(String(m)), warn: () => undefined };
    const status = runCloudWrangler(["prod:deploy"], { root: root + "/", bin: "w", viteBin: "v", spawn, log, env: {}, confirm: () => true });
    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("prints no token, id or account in its output", () => {
    const { root, calls } = prodSetup();
    const out = prodRun(root, calls, "prod:deploy", { typed: "DEPLOY PRODUCTION", env: { CLOUDFLARE_API_TOKEN: "tok-secret-1" } });
    expect(out.errors.join("\n")).not.toMatch(/tok-secret-1|55555555/);
  });
});

describe("confirmTyped", () => {
  it("accepts only the exact phrase on a TTY and never prints the phrase typed", async () => {
    // @ts-expect-error plain .mjs module without types
    const { confirmTyped } = await import("./lib/confirm.mjs");
    const out: string[] = [];
    const base = { write: (m: string) => out.push(m) };
    expect(confirmTyped("GO", { ...base, isTTY: true, readLine: () => "GO" })).toBe(true);
    expect(confirmTyped("GO", { ...base, isTTY: true, readLine: () => "go" })).toBe(false);
    expect(confirmTyped("GO", { ...base, isTTY: false, readLine: () => "GO" })).toBe(false);
    expect(out.join("")).not.toContain("go\n");
  });
});
