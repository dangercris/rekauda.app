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
const guardCore = read("scripts/lib/cloud-guard-core.mjs");
const baseline = read("migrations-cloud/0001_baseline.sql");
/** Every doc this change edits: the leak, language and dash scans cover all of them. */
const EDITED_DOCS = [RUNBOOK, "README.md", "docs/CLOUD-SANDBOX-CHECKLIST.md", "docs/DESPLIEGUE-CLOUDFLARE.md", "docs/OPERACION.md"];
const FORBIDDEN_WORDS = ["kru" + "ger", "1b" + "gu", "vestuario" + "-musical", "77008" + "43439", "esz" + "tudio"];
const VOSEO = /\b(tenés|podés|hacé|ejecutá|corré|verificá|guardá|borrá|revisá|usá|elegí|confirmá|escribí|mirá|asegurate|fijate|vos|sabés|querés|debés|andá|poné|dejá|esperá|probá|anotá|copiá)\b/i;

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
    const topics = ["Node >= 22.18", "productionRoot", "LEGACY_REDIRECTS", "P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "MATCH", "MISMATCH", "provision.lock", "handover.txt", "pilot-final", "Responsable: dueño", "Revertir", "Go", "No-go", "pilot:demo-workdir", "pilot-final", "max-age=300"];
    expect(topics.filter((topic) => !runbook.includes(topic))).toEqual([]);
  });

  it("warns that removing the apex entry and deploying detaches the apex", () => {
    expect(runbook).toMatch(/quitar la entrada del apex[^\n]*desvincula|desvincula[^\n]*apex/i);
  });

  it("leaks nothing: no real names, secrets, account ids, real hosts or ids", () => {
    // Built from fragments so this file never contains the forbidden words itself (a repository-wide scan stays clean).
    expect(runbook).not.toMatch(new RegExp(FORBIDDEN_WORDS.join("|"), "i"));
    expect(runbook).not.toMatch(/\b[0-9a-f]{32}\b/i);
    expect(runbook).not.toMatch(/\b(?!0{8}-|1{8}-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
    expect(runbook).not.toMatch(/[\w.+-]+@(?!example\.(test|net)\b|colegio-demo\.example\.test\b)[\w-]+\.[a-z]{2,}/i);
    expect(runbook).not.toMatch(/\b(token|secret|password)\s*[:=]\s*\S{12,}/i);
    expect(runbook).not.toMatch(/rekauda\.app/i);
    const plain = runbook.replace(/<[^>\n]*>/g, "example.test");
    const hosts = [...plain.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(hosts.filter((h) => !/(^|\.)example\.(test|net)$/.test(h) && !h.endsWith(".invalid") && h !== "localhost")).toEqual([]);
  });

  it("names no bare hostname either (only example.test, example.net and .invalid)", () => {
    const plain = runbook.replace(/<[^>\n]*>/g, "example.test");
    const bare = [...plain.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|app|net|org|io|ec|dev|co|edu|me|xyz|cloud|email|test|invalid)\b/gi)].map((m) => m[0].toLowerCase());
    expect(bare.filter((h) => !/(^|\.)example\.(test|net)$/.test(h) && !h.endsWith(".invalid"))).toEqual([]);
  });

  it.each(EDITED_DOCS)("%s has no real names, no voseo and no em dashes", (file) => {
    const text = read(file);
    expect(text).not.toMatch(new RegExp(FORBIDDEN_WORDS.join("|"), "i"));
    expect(text).not.toMatch(VOSEO);
    expect(text).not.toMatch(/—|–/);
  });

  it("uses no double hyphen as punctuation", () => {
    expect(runbook).not.toMatch(/ -- /);
  });

  it("documents exactly the keys of the pilot reference file that the code accepts", () => {
    const codeKeys = JSON.parse(/const PILOT_FILE_KEYS = (\[[^\]]*\])/.exec(guardCore)![1]!) as string[];
    const block = [...runbook.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.includes("productionRoot"))!;
    expect(Object.keys(JSON.parse(block)).sort()).toEqual([...codeKeys].sort());
  });

  it("lists the enforced top-level keys of the production config, none that the guard rejects", () => {
    const top = JSON.parse(/const SANDBOX_TOP_KEYS = (\[[^\]]*\])/.exec(guardCore)![1]!) as string[];
    const allowed = [...top, "routes", "send_email", "triggers"].filter((k) => k !== "$schema");
    const line = runbook.split("\n").find((l) => l.includes("claves de primer nivel"))!;
    const named = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it("writes the manual cleanup SQL exactly as undo.mjs builds it, in the same order", async () => {
    // @ts-expect-error plain .mjs module without types
    const { undoStatements } = await import("./lib/import/undo.mjs");
    const tenant = "00000000-0000-4000-8000-000000000000";
    const expected = (undoStatements(tenant, { tenant: true, userIds: ["USERID"] }) as string[]).map((sql) => sql.replaceAll(tenant, "<tenant-id>").replaceAll("'USERID'", "'<user-id>'"));
    expect(expected).toHaveLength(10);
    let at = -1;
    for (const sql of expected) {
      const found = runbook.indexOf(sql);
      expect(found, sql).toBeGreaterThan(at);
      at = found;
    }
  });

  it("every DELETE names a column that exists in that table of the baseline schema", () => {
    const columns = new Map<string, string[]>();
    for (const m of baseline.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
      columns.set(m[1]!, [...m[2]!.matchAll(/^\s{2}(\w+)\s/gm)].map((c) => c[1]!));
    }
    expect(columns.get("tenants")).toContain("source");
    const deletes = [...runbook.matchAll(/DELETE FROM (\w+) WHERE (\w+)/g)];
    expect(deletes.length).toBeGreaterThanOrEqual(10);
    const bad = deletes.filter(([, table, column]) => !(columns.get(table!) ?? []).includes(column!)).map(([, t, c]) => `${t}.${c}`);
    expect(bad).toEqual([]);
  });

  it("says undo never removes a reused owner, in the reference notes and in the manual removal", () => {
    const text = read("docs/MIGRACION-PILOTO.md");
    expect(text).toMatch(/reusedOwnerId/);
    const notes = text.slice(text.indexOf("Notas: el `<tenant-id>`"));
    expect(notes.slice(0, notes.indexOf("\n"))).toMatch(/REUSE OWNER[^\n]*no (se )?borra/i);
    const manual = text.slice(text.indexOf("Lee los usuarios **antes**"));
    expect(manual.slice(0, manual.indexOf("Ejecuta una a una"))).toMatch(/REUSE OWNER[\s\S]*no la borres/i);
  });

  it("has a not-live check before the manual deletes and a Time Travel bookmark", () => {
    const manual = runbook.slice(runbook.indexOf("DELETE FROM bank_movements") - 3500, runbook.indexOf("DELETE FROM bank_movements"));
    expect(manual).toMatch(/SELECT COUNT\(\*\)/);
    expect(manual).toMatch(/Time Travel/);
    expect(runbook).toMatch(/SELECT user_id FROM memberships WHERE tenant_id = '<tenant-id>'/);
  });

  it("puts each typed phrase in the same section as its command", () => {
    const pairs = [...core.matchAll(/"((?:prod|pilot):[a-z-]+)": \{[^\n]*?phrase: "([A-Z][A-Z ]+)"/g)].map((m) => [m[1]!, m[2]!] as const);
    pairs.push(["pilot:export", exportPhrase]);
    expect(pairs.length).toBeGreaterThanOrEqual(9);
    const sections = runbook.split(/^#{2,3} /m);
    const problems: string[] = [];
    for (const [command, phrase] of pairs) {
      const mention = new RegExp(`pnpm ${command.replace(":", ":")}(?![\\w:-])`);
      for (const section of sections.filter((sec) => mention.test(sec))) {
        if (!new RegExp(`\`${phrase}[ \`]`).test(section)) problems.push(`${command} without \`${phrase}\` in "${section.split("\n")[0]}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("tests P0.6 before the first real deploy, the exclusions and the wildcard", () => {
    const p06 = runbook.indexOf("**P0.6");
    const firstDeploy = runbook.indexOf("pnpm prod:deploy");
    const exclusions = runbook.indexOf("Crea las rutas de exclusión");
    const wildcard = runbook.indexOf("DNS `*` AAAA");
    expect(p06).toBeGreaterThan(0);
    for (const later of [firstDeploy, exclusions, wildcard]) expect(later).toBeGreaterThan(p06);
    expect(runbook).toMatch(/tras cada despliegue[^\n]*exclusiones/i);
  });

  it("keeps the inbound mail checks out of any tenant that must stay undoable", () => {
    const section = runbook.slice(runbook.indexOf("### 1.5"), runbook.indexOf("### 1.6"));
    for (const excluded of ["4.2", "5.2", "5.3", "5.4", "5.5"]) expect(section).toContain(excluded);
    expect(section).toMatch(/no (se )?ejecutes?|excluy/i);
  });

  it("rolls back every resource of phase 0, and states window, account check and revert for live-zone probes", () => {
    const gates = runbook.slice(runbook.indexOf("### Compuertas de la fase 0"), runbook.indexOf("## 2. Fase 1"));
    for (const needle of ["D1", "R2", "limitadores", "send_email"]) expect(gates).toContain(needle);
    const probes = runbook.slice(runbook.indexOf("### 1.2"), runbook.indexOf("### 1.3"));
    expect(probes).toMatch(/Ventana/);
    expect(probes).toContain("wrangler whoami");
    expect(probes).not.toMatch(/solo recursos de la sandbox/i);
  });

  it("warns that demo ids are global and notes Node in the demo workdir row", () => {
    expect(runbook).toMatch(/ids[^\n]*(globales|claves primarias globales)[^\n]*colisi/i);
    const row = runbook.split("\n").find((l) => l.includes("`pnpm pilot:demo-workdir` | ninguno"))!;
    expect(row).toContain("Node >= 22.18");
  });

  it("has a consolidated Nunca section", () => {
    const from = runbook.indexOf("## Nunca");
    const section = runbook.slice(from, runbook.indexOf("\n## ", from + 5));
    expect(section.length).toBeGreaterThan(10);
    for (const needle of ["wrangler", "-y", "manifest.json", "import.sql", "tenant.json", "Revertir", "t/<"]) expect(section).toContain(needle);
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
