import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The migration runbook is part of the safety net: every operator command must be documented with its typed phrase, the
// document must stay free of real names and secrets (the repository is public), and it must be reachable from the docs.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const RUNBOOK = "docs/MIGRACION-PILOTO.md";
const runbook = existsSync(new URL(`../${RUNBOOK}`, import.meta.url)) ? read(RUNBOOK) : "";
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const core = read("scripts/lib/cloud-wrangler-core.mjs");

/** Every `pnpm` script that touches production or the pilot. */
const operatorScripts = Object.keys(pkg.scripts).filter((name) => /^(prod|pilot):/.test(name));
/** Typed phrases declared by the wrapper (`phrase: "X"`), plus the export phrase from its own module. */
const phrases = [...core.matchAll(/phrase: "([A-Z][A-Z ]+)"/g)].map((m) => m[1]!);
const exportPhrase = /EXPORT_PHRASE = "([^"]+)"/.exec(read("scripts/lib/pilot-export.mjs"))![1]!;

describe("docs/MIGRACION-PILOTO.md", () => {
  it("exists", () => {
    expect(runbook.length).toBeGreaterThan(0);
  });

  it("documents every prod:* and pilot:* script", () => {
    expect(operatorScripts.length).toBeGreaterThan(10);
    const missing = operatorScripts.filter((name) => !runbook.includes(`pnpm ${name}`));
    expect(missing).toEqual([]);
  });

  it("documents every typed phrase, the apex phrase and REUSE OWNER", () => {
    expect(phrases).toEqual(expect.arrayContaining(["SWITCH APEX", "PROVISION", "IMPORT", "UNDO DATA", "UNDO TENANT"]));
    const missing = [...phrases, exportPhrase, "REUSE OWNER"].filter((phrase) => !runbook.includes(phrase));
    expect(missing).toEqual([]);
  });

  it("covers the required topics", () => {
    const topics = ["Node >= 22.18", "productionRoot", "LEGACY_REDIRECTS", "P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "MATCH", "MISMATCH", "provision.lock", "handover.txt", "pilot-final", "Responsable: dueño", "Revertir", "Go", "No-go"];
    expect(topics.filter((topic) => !runbook.includes(topic))).toEqual([]);
  });

  it("warns that removing the apex entry and deploying detaches the apex", () => {
    expect(runbook).toMatch(/quitar la entrada del apex[^\n]*desvincula|desvincula[^\n]*apex/i);
  });

  it("leaks nothing: no real names, secrets, account ids, real hosts or ids", () => {
    // Built from fragments so this file never contains the forbidden words itself (a repository-wide scan stays clean).
    expect(runbook).not.toMatch(new RegExp(["kru" + "ger", "1b" + "gu", "vestuario" + "-musical", "77008" + "43439", "esz" + "tudio"].join("|"), "i"));
    expect(runbook).not.toMatch(/\b[0-9a-f]{32}\b/i);
    expect(runbook).not.toMatch(/\b(?!0{8}-|1{8}-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
    expect(runbook).not.toMatch(/[\w.+-]+@(?!example\.(test|net)\b|colegio-demo\.example\.test\b)[\w-]+\.[a-z]{2,}/i);
    expect(runbook).not.toMatch(/\b(token|secret|password)\s*[:=]\s*\S{12,}/i);
    expect(runbook).not.toMatch(/rekauda\.app/i);
    const hosts = [...runbook.replace(/<[^>\n]*>/g, "example.test").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(hosts.filter((h) => !/(^|\.)example\.(test|net)$/.test(h) && !h.endsWith(".invalid") && h !== "localhost")).toEqual([]);
  });

  it("is neutral Spanish: no voseo, no em dashes, no double hyphen as punctuation", () => {
    expect(runbook).not.toMatch(/—|–/);
    expect(runbook).not.toMatch(/ -- /);
    expect(runbook).not.toMatch(/\b(tenés|podés|hacé|ejecutá|corré|verificá|guardá|borrá|revisá|usá|elegí|confirmá|escribí|mirá|asegurate|fijate|vos)\b/i);
  });

  it("every relative link resolves", () => {
    const links = [...runbook.matchAll(/\]\((?!https?:|#)([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]!);
    const broken = links.filter((link) => !existsSync(resolve(dirname(new URL(`../${RUNBOOK}`, import.meta.url).pathname), link)));
    expect(broken).toEqual([]);
  });

  it.each(["README.md", "docs/CLOUD-SANDBOX-CHECKLIST.md", "docs/DESPLIEGUE-CLOUDFLARE.md", "docs/OPERACION.md"])("is linked from %s", (file) => {
    expect(read(file)).toContain("MIGRACION-PILOTO.md");
  });
});
