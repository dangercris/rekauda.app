import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeCheckout } from "./fake-checkout";
import { TENANT_ID, makeTables } from "./import/pilot-fixture";
// @ts-expect-error plain .mjs module without types
import { runDemoWorkdir } from "./demo-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { canonicalHash, runPilotCleanup } from "./pilot-export.mjs";
// @ts-expect-error plain .mjs module without types
import { openWorkdir, readManifest, writeManifest } from "./private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { runImportPlan } from "./import/plan.mjs";
// @ts-expect-error plain .mjs module without types
import { runCloudWrangler } from "./cloud-wrangler-core.mjs";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup() {
  const root = fakeCheckout("demo-workdir", {});
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "demo-workdir-tmp-")));
  dirs.push(root, tmp);
  const out: string[] = [];
  const log = { log: (m: string) => out.push(m), warn: (m: string) => out.push(m), error: (m: string) => out.push(m) };
  return { root: root + "/", tmp, out, log };
}

describe("pilot:demo-workdir", () => {
  it("creates a private workdir with two identical invented exports in the real export format", () => {
    const { root, tmp, log, out } = setup();
    expect(runDemoWorkdir([], { root, tmp, log })).toBe(0);
    const dir = out.join("\n").match(/workdir=(\S+)/)![1]!;
    const { manifest } = openWorkdir(dir, { root, tmp });
    expect(manifest.exports).toHaveLength(2);
    expect(manifest.exports[0].hash).toBe(manifest.exports[1].hash);
    expect(manifest.exports[1].matchesFirst).toBe(true);
    expect(manifest.mismatchSeen).toBeUndefined();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const e of manifest.exports) {
      expect(statSync(join(dir, e.file)).mode & 0o777).toBe(0o600);
      const file = JSON.parse(readFileSync(join(dir, e.file), "utf8"));
      expect(file.version).toBe(1);
      expect(Object.keys(file.tables)).toEqual(["collections", "payments", "students", "bank_movements"]);
      expect(canonicalHash(file.tables)).toBe(e.hash);
      expect(e.counts).toEqual({ collections: 2, payments: 3, students: 3, bank_movements: 2 });
    }
    expect(manifest.tenant).toBeUndefined();
  });

  it("prints the workdir and the counts, never row content", () => {
    const { root, tmp, log, out } = setup();
    runDemoWorkdir([], { root, tmp, log });
    const text = out.join("\n");
    expect(text).toContain("collections=2");
    expect(text).not.toMatch(/Familia|Alumno|Banco Demo|0990000000/);
  });

  it("takes no arguments", () => {
    const { root, tmp, log, out } = setup();
    expect(runDemoWorkdir(["--x"], { root, tmp, log })).toBe(1);
    expect(runDemoWorkdir(["x"], { root, tmp, log })).toBe(1);
    expect(out.join("\n")).toContain("REFUSED");
  });

  it("produces a workdir the import plan accepts once a tenant is provisioned (same format as a real export)", () => {
    const { root, tmp, log, out } = setup();
    runDemoWorkdir([], { root, tmp, log });
    const dir = out.join("\n").match(/workdir=(\S+)/)![1]!;
    const manifest = readManifest(dir);
    manifest.tenant = { id: TENANT_ID, slug: "curso-demo", state: "provisioned" };
    writeManifest(dir, manifest);
    const quiet = { error: () => undefined, warn: () => undefined, log: () => undefined };
    expect(runImportPlan([dir], { root, log: quiet, tmp })).toBe(0);
  });

  it("is removed by pilot:cleanup like any workdir", () => {
    const { root, tmp, log, out } = setup();
    runDemoWorkdir([], { root, tmp, log });
    const dir = out.join("\n").match(/workdir=(\S+)/)![1]!;
    expect(runPilotCleanup([dir], { root, log, tmp })).toBe(0);
  });

  it("is reachable through the wrapper, spawns nothing and refuses extra arguments", () => {
    const { root, tmp, log } = setup();
    const calls: unknown[] = [];
    const spawn = (...a: unknown[]) => (calls.push(a), { status: 0 });
    const ctx = { root, tmp, log, spawn, confirm: () => false, env: {} };
    expect(runCloudWrangler(["pilot:demo-workdir"], ctx)).toBe(0);
    expect(runCloudWrangler(["pilot:demo-workdir", "extra"], ctx)).toBe(1);
    expect(calls).toEqual([]);
  });

  it("uses only the invented fixture", () => {
    expect(JSON.stringify(makeTables())).not.toMatch(/@/);
  });
});
