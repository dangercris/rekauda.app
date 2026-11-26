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
    expect(cloudNames.sort()).toEqual(["cloud:dev", "cloud:guard", "cloud:migrate:local", "cloud:types"]);
  });

  it("cloud:guard runs the guard in local mode", () => {
    expect(firstRealStep(scripts["cloud:guard"]!)).toBe("node scripts/cloud-guard.mjs --local");
  });

  it.each(["cloud:migrate:local", "cloud:dev", "cloud:types"])("%s goes through the wrapper, which runs the guard", (name) => {
    expect(firstRealStep(scripts[name]!)).toMatch(/^node scripts\/cloud-wrangler\.mjs (d1|dev|types)\b/);
  });

  it("applies migrations through the wrapper, which forces the local D1", () => {
    expect(scripts["cloud:migrate:local"]).toContain("cloud-wrangler.mjs d1 migrations apply DB");
  });

  it.each(cloudNames)("%s hardcodes no wrangler flags that the wrapper owns", (name) => {
    expect(scripts[name]).not.toMatch(/--remote|--config|--env|--persist-to|\bsecret\b/);
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
