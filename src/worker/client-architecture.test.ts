/**
 * Architecture scan for the client (runs in the node project because it reads source files): nothing the browser bundle loads may read per-school values at module level.
 * The tenant's config reaches components through ConfigProvider only (boot JSON or /api/config).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
const REPO = join(CLIENT, "..", "..");

/** Any static, dynamic or require-style import whose specifier names the bundled config. */
const BUNDLED_IMPORT = /(?:from|import|require)\s*\(?\s*["'][^"']*(?:rekauda\.config|instance-bundled)(?:\.[cm]?[jt]s)?["']/;
const ANALYTICS_IMPORT = /(?:from|import)\s*\(?\s*["'][^"']*analytics[^"']*["']/;

export function importsBundledConfig(source: string): boolean {
  return BUNDLED_IMPORT.test(source);
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "test" ? [] : productionFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  });
}

const files = productionFiles(CLIENT);
const rel = (path: string): string => relative(CLIENT, path);

describe("client reads no per-school value at module level", () => {
  it("detects every way of importing the bundled config", () => {
    for (const code of [
      'import { TREASURY } from "../../shared/instance-bundled";',
      'import config from "../../../rekauda.config";',
      'const m = await import("../shared/instance-bundled");',
      'import x from "../../rekauda.config.ts";',
    ]) {
      expect(importsBundledConfig(code)).toBe(true);
    }
    expect(importsBundledConfig('import { resolveInstance } from "../../shared/instance";')).toBe(false);
  });

  it("scans the whole client", () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.map(rel)).toContain(join("lib", "config", "ConfigProvider.tsx"));
  });

  it("has no client module importing rekauda.config or instance-bundled", () => {
    expect(files.filter((f) => importsBundledConfig(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("has deleted instance-bundled", () => {
    expect(existsSync(join(REPO, "src", "shared", "instance-bundled.ts"))).toBe(false);
  });

  it("never injects tenant strings as HTML", () => {
    expect(files.filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML")).map(rel)).toEqual([]);
  });

  it("keeps analytics out of the admin app", () => {
    const admin = files.filter((f) => rel(f).startsWith("admin"));
    expect(admin.length).toBeGreaterThan(20);
    expect(admin.filter((f) => ANALYTICS_IMPORT.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });
});

describe("build does not need tenant values", () => {
  it("leaves no %REKAUDA_*% placeholder in the HTML shells", () => {
    for (const name of ["index.html", "admin.html"]) expect(readFileSync(join(REPO, name), "utf8")).not.toMatch(/%REKAUDA_/);
  });

  it("does not read rekauda.config from the Vite config", () => {
    const vite = readFileSync(join(REPO, "vite.config.ts"), "utf8");
    expect(importsBundledConfig(vite)).toBe(false);
    expect(vite).not.toContain("REKAUDA_");
    expect(vite).not.toContain("instanceHtml");
  });
});
