import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
const scripts = pkg.scripts;
const cloudNames = Object.keys(scripts).filter((name) => name.startsWith("cloud:"));
const REFUSAL = "node scripts/cloud-guard.mjs --refuse-branch";

/** Splits a shell line on && ; || and | so every command is inspected, not only the first. */
const steps = (command: string): string[] => command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
const firstRealStep = (command: string): string | undefined => steps(command).find((s) => !s.includes("ensure-config.mjs"));

describe("cloud:* scripts", () => {
  it("defines the expected cloud scripts", () => {
    expect(cloudNames.sort()).toEqual(["cloud:dev", "cloud:guard", "cloud:migrate:local", "cloud:seed:local", "cloud:types"]);
  });

  it("cloud:guard runs the guard in local mode", () => {
    expect(firstRealStep(scripts["cloud:guard"]!)).toBe("node scripts/cloud-guard.mjs --local");
  });

  it.each(["cloud:migrate:local", "cloud:seed:local", "cloud:dev", "cloud:types"])("%s goes through the wrapper, which runs the guard", (name) => {
    expect(firstRealStep(scripts[name]!)).toMatch(/^node scripts\/cloud-wrangler\.mjs (d1|dev|types)\b/);
  });

  it("applies migrations through the wrapper, which forces the local D1", () => {
    expect(scripts["cloud:migrate:local"]).toContain("cloud-wrangler.mjs d1 migrations apply DB");
  });

  it("seeds the local D1 from the fictional seed file through the wrapper", () => {
    expect(scripts["cloud:seed:local"]).toContain("cloud-wrangler.mjs d1 execute DB --file scripts/cloud-seed.local.sql");
  });

  it.each(cloudNames)("%s hardcodes no wrangler flags that the wrapper owns", (name) => {
    expect(scripts[name]).not.toMatch(/--remote|--config|--env|--persist-to|\bsecret\b/);
  });
});

const sandboxNames = Object.keys(scripts).filter((name) => name.startsWith("sandbox:"));

describe("sandbox:* scripts", () => {
  it("defines the expected sandbox scripts", () => {
    expect(sandboxNames.sort()).toEqual(["sandbox:deploy", "sandbox:guard", "sandbox:migrate", "sandbox:seed", "sandbox:status"]);
  });

  it("sandbox:guard runs the sandbox guard", () => {
    expect(scripts["sandbox:guard"]).toBe("node scripts/ensure-config.mjs && node scripts/cloud-guard.mjs --sandbox");
  });

  it.each(["migrate", "seed", "deploy", "status"])("sandbox:%s ensures the config, then goes through the wrapper subcommand of the same name", (name) => {
    expect(scripts[`sandbox:${name}`]).toBe(`node scripts/ensure-config.mjs && node scripts/cloud-wrangler.mjs sandbox:${name}`);
  });

  it.each(sandboxNames)("%s hardcodes no wrangler flags and never names the pilot scripts", (name) => {
    expect(scripts[name]).not.toMatch(/--remote|--config|--env|--persist-to|--name|\bsecret\b|\bpnpm\b/);
  });
});

const prodNames = Object.keys(scripts).filter((name) => name.startsWith("prod:"));

describe("prod:* scripts", () => {
  it("defines the expected production scripts", () => {
    expect(prodNames.sort()).toEqual(["prod:deploy", "prod:guard", "prod:migrate", "prod:status", "prod:switch-apex"]);
  });

  it("prod:guard runs the production guard", () => {
    expect(scripts["prod:guard"]).toBe("node scripts/cloud-guard.mjs --production");
  });

  it.each(["migrate", "deploy", "switch-apex", "status"])("prod:%s goes through the wrapper subcommand of the same name, with no flags", (name) => {
    expect(scripts[`prod:${name}`]).toBe(`node scripts/cloud-wrangler.mjs prod:${name}`);
  });

  it("never auto-creates the production config", () => {
    for (const name of prodNames) expect(scripts[name]).not.toContain("ensure-config");
  });
});

describe("every script in package.json", () => {
  it.each(Object.entries(scripts))("%s never reaches remote or invokes wrangler outside the wrapper", (name, command) => {
    expect(command).not.toContain("--remote");
    expect(command).not.toMatch(/\bsecret\b/);
    for (const step of steps(command)) {
      const withoutWrapper = step.replace("cloud-wrangler.mjs", "");
      if (/\bwrangler\b/.test(withoutWrapper)) throw new Error(`${name}: wrangler invoked outside the wrapper: ${step}`);
    }
  });

  it.each(["deploy", "db:migrate:remote", "db:migrate:local", "dev:api", "types"])("pilot script %s is replaced by the branch refusal", (name) => {
    expect(scripts[name]).toBe(REFUSAL);
  });

  it("only cloud:* scripts mention migrations-cloud", () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith("cloud:")) expect(command, name).not.toContain("migrations-cloud");
    }
  });
});

describe("pilot:* scripts", () => {
  it("defines only the export and the cleanup, both through the wrapper with no flags", () => {
    const names = Object.keys(scripts).filter((name) => name.startsWith("pilot:"));
    expect(names.sort()).toEqual(["pilot:cleanup", "pilot:export"]);
    expect(scripts["pilot:export"]).toBe("node scripts/cloud-wrangler.mjs pilot:export");
    expect(scripts["pilot:cleanup"]).toBe("node scripts/cloud-wrangler.mjs pilot:cleanup");
  });
});
