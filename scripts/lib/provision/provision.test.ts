import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import example from "../../../rekauda.config.example";
import { sha256Hex } from "../../../src/worker/ids";
import { createCloudTestDb } from "../../../src/worker/test/d1-cloud";
import { fakeCheckout } from "../fake-checkout";
// @ts-expect-error plain .mjs module without types
import { createWorkdir, readManifest } from "../private-workdir.mjs";
// @ts-expect-error plain .mjs module without types
import { mintToken, writeHandover } from "./inbound-token.mjs";
// @ts-expect-error plain .mjs module without types
import { prepareProvision, runProvision } from "./provision.mjs";
// @ts-expect-error plain .mjs module without types
import { readQr, stageQr } from "./qr.mjs";
// @ts-expect-error plain .mjs module without types
import { loadTenantInput } from "./tenant-input.mjs";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const TENANT_ID = "c0000000-0000-4000-8000-0000000000c1";
const TARGET = { name: "rekauda-cloud-app", vars: { ROOT_DOMAIN: "colegio-demo.example.test", INBOUND_DOMAIN: "in.colegio-demo.example.test" } };

function world(over: { input?: Record<string, unknown> | string; qr?: Buffer; mode?: number } = {}) {
  const root = fakeCheckout("provision", {});
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "provision-tmp-")));
  dirs.push(root, tmp);
  const dir = createWorkdir({ root: root + "/", tmp });
  const qrPath = join(dir, "..", `qr-source-${Math.random().toString(36).slice(2)}.png`);
  writeFileSync(qrPath, over.qr ?? PNG);
  dirs.push(qrPath);
  const input = over.input ?? { slug: "curso-demo", ownerEmail: "Owner@Example.test", config: JSON.parse(JSON.stringify(example)), qrPath };
  writeFileSync(join(dir, "tenant.json"), typeof input === "string" ? input : JSON.stringify(input), { mode: over.mode ?? 0o600 });
  chmodSync(join(dir, "tenant.json"), over.mode ?? 0o600);
  return { dir, qrPath, tmp, root };
}

describe("loadTenantInput", () => {
  it("returns the validated input with the email normalized", () => {
    const w = world();
    const input = loadTenantInput(w.dir);
    expect(input).toMatchObject({ slug: "curso-demo", ownerEmail: "owner@example.test", qrPath: w.qrPath });
    expect(input.config.schoolName).toBe(example.schoolName);
  });

  it.each([
    ["not json", "{ nope"],
    ["an extra key", { slug: "curso-demo", ownerEmail: "o@example.test", config: {}, qrPath: "/x", extra: 1 }],
    ["a reserved slug", { slug: "admin", ownerEmail: "o@example.test", config: {}, qrPath: "/x" }],
    ["an uppercase slug", { slug: "Curso-Demo", ownerEmail: "o@example.test", config: {}, qrPath: "/x" }],
    ["a bad email", { slug: "curso-demo", ownerEmail: "not-an-email", config: {}, qrPath: "/x" }],
    ["an email with a semicolon", { slug: "curso-demo", ownerEmail: "a;b@example.test", config: JSON.parse(JSON.stringify(example)), qrPath: "/x/qr.png" }],
    ["an invalid config", { slug: "curso-demo", ownerEmail: "o@example.test", config: { schoolName: "Secret School Name" }, qrPath: "/x" }],
    ["a relative qr path", { slug: "curso-demo", ownerEmail: "o@example.test", config: JSON.parse(JSON.stringify(example)), qrPath: "qr.png" }],
  ])("rejects %s with a generic error that echoes no value", (_name, input) => {
    const w = world({ input: input as never });
    expect(() => loadTenantInput(w.dir)).toThrow(/^invalid tenant input$/);
  });

  it("rejects a file that other users can read, a symlink and a missing file", () => {
    const loose = world({ mode: 0o644 });
    expect(() => loadTenantInput(loose.dir)).toThrow(/invalid tenant input/);
    const linked = world();
    rmSync(join(linked.dir, "tenant.json"));
    symlinkSync(linked.qrPath, join(linked.dir, "tenant.json"));
    expect(() => loadTenantInput(linked.dir)).toThrow(/invalid tenant input/);
    const missing = world();
    rmSync(join(missing.dir, "tenant.json"));
    expect(() => loadTenantInput(missing.dir)).toThrow(/invalid tenant input/);
  });
});

describe("inbound token", () => {
  it("mints a 32 char lowercase token whose hash is the sha256 the worker computes", async () => {
    const { token, hash, address } = mintToken(TARGET.vars.INBOUND_DOMAIN);
    expect(token).toMatch(/^[a-z0-9]{16,64}$/);
    expect(hash).toBe(await sha256Hex(new TextEncoder().encode(token)));
    expect(address).toBe(`d-${token}@in.colegio-demo.example.test`);
    expect(mintToken(TARGET.vars.INBOUND_DOMAIN).token).not.toBe(token);
  });

  it("writes the handover file with mode 0600, and keeps 0600 when it is written again", () => {
    const w = world();
    const file = writeHandover(w.dir, "d-aaaa@in.example.test");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("d-aaaa@in.example.test\n");
    writeHandover(w.dir, "d-bbbb@in.example.test");
    expect(readFileSync(file, "utf8")).toBe("d-bbbb@in.example.test\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("QR", () => {
  const read = (bytes: Buffer, name = "x.bin") => {
    const dir = mkdtempSync(join(tmpdir(), "qr-"));
    dirs.push(dir);
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };

  it.each([
    ["png", PNG, "image/png"],
    ["jpg", JPG, "image/jpeg"],
    ["webp", WEBP, "image/webp"],
  ])("accepts %s by its magic bytes, whatever the file name", (ext, bytes, type) => {
    expect(readQr(read(bytes, "named.dat"))).toMatchObject({ ext, contentType: type });
  });

  it("rejects wrong magic bytes, a RIFF that is not WEBP, empty files and files over 1 MB", () => {
    for (const bytes of [Buffer.from("plain text, not an image"), Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WAVEfmt ")]), Buffer.alloc(0)]) expect(() => readQr(read(bytes))).toThrow(/invalid QR image/);
    expect(readQr(read(Buffer.concat([PNG, Buffer.alloc(1024 * 1024 - PNG.length)])))).toMatchObject({ ext: "png" });
    expect(() => readQr(read(Buffer.concat([PNG, Buffer.alloc(1024 * 1024 - PNG.length + 1)])))).toThrow(/invalid QR image/);
  });

  it("rejects a directory, a symlink and a missing path", () => {
    const path = read(PNG);
    const link = path + ".lnk";
    symlinkSync(path, link);
    for (const bad of [join(path, ".."), link, path + ".missing"]) expect(() => readQr(bad)).toThrow(/invalid QR image/);
  });

  it("stages a private copy named deuna-qr.<ext> (dir 0700, file 0600)", () => {
    const w = world();
    const { copyDir, file } = stageQr(w.dir, PNG, "png");
    expect(file).toBe(join(copyDir, "deuna-qr.png"));
    expect(statSync(copyDir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file)).toEqual(PNG);
  });
});

/** An in-memory Cloud database behind the remote methods provisioning may use. */
function fakeRemote(over: { failPut?: boolean; failInsertAt?: number; tamper?: boolean } = {}) {
  const db = createCloudTestDb();
  const calls: string[] = [];
  const puts: { tenantId: string; ext: string; contentType: string; bytes: Buffer; mode: number }[] = [];
  const inserts: string[] = [];
  const remote = {
    select: (sql: string) => (calls.push("select"), db.sqlite.prepare(sql).all() as Record<string, unknown>[]),
    insert: (sql: string) => {
      calls.push("insert");
      if (over.failInsertAt === inserts.length) throw new Error("remote command failed");
      inserts.push(sql);
      db.sqlite.exec(sql);
      if (over.tamper && sql.startsWith("INSERT INTO tenants")) db.sqlite.exec("UPDATE tenants SET inbound_token_hash = 'tampered'");
    },
    put: (spec: { tenantId: string; ext: string; contentType: string; file: string }) => {
      calls.push("put");
      if (over.failPut) throw new Error("remote command failed");
      puts.push({ tenantId: spec.tenantId, ext: spec.ext, contentType: spec.contentType, bytes: readFileSync(spec.file), mode: statSync(spec.file).mode & 0o777 });
    },
  };
  return { db, remote, calls, puts, inserts };
}

function run(w: ReturnType<typeof world>, remote: unknown, extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const { manifest } = { manifest: readManifest(w.dir) };
  const prepared = prepareProvision(w.dir);
  const status = runProvision({ dir: w.dir, manifest, tenantId: TENANT_ID, slug: prepared.input.slug, prepared }, { remote, log, target: TARGET, now: () => "2026-11-27T00:00:00Z", ...extra }) as number;
  return { status, out: out.join("\n") };
}

describe("runProvision", () => {
  it("uploads the QR, writes the tenant with only the token hash, hands the address over privately and records the tenant", async () => {
    const w = world();
    const { db, remote, puts, calls } = fakeRemote();
    const { status, out } = run(w, remote);
    expect(status).toBe(0);
    expect(calls.indexOf("put")).toBeLessThan(calls.indexOf("insert"));
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ tenantId: TENANT_ID, ext: "png", contentType: "image/png", mode: 0o600 });
    expect(puts[0]!.bytes).toEqual(PNG);
    const tenant = db.sqlite.prepare("SELECT source, r2_prefix, qr_key, inbound_token_hash FROM tenants").get() as Record<string, string>;
    expect(tenant).toMatchObject({ source: "pilot_import", r2_prefix: `t/${TENANT_ID}/`, qr_key: `t/${TENANT_ID}/assets/deuna-qr.png` });
    const handover = join(w.dir, "handover.txt");
    const address = readFileSync(handover, "utf8").trim();
    expect(statSync(handover).mode & 0o777).toBe(0o600);
    expect(tenant.inbound_token_hash).toBe(await sha256Hex(new TextEncoder().encode(address.slice(2, address.indexOf("@")))));
    expect(db.sqlite.prepare("SELECT hostname FROM tenant_domains").get()).toEqual({ hostname: "curso-demo.colegio-demo.example.test" });
    expect(readManifest(w.dir).tenant).toEqual({ id: TENANT_ID, slug: "curso-demo" });
    expect(readdirSync(w.dir).filter((n) => n.startsWith("qr-"))).toEqual([]);
    const token = address.slice(2, address.indexOf("@"));
    expect(out).toContain(handover);
    expect(out).not.toMatch(new RegExp(`${token}|owner@example|in\\.colegio`));
  });

  it("refuses an invalid input before any remote call or file", () => {
    const w = world({ input: "{ nope" });
    const { remote, calls } = fakeRemote();
    expect(() => run(w, remote)).toThrow(/invalid tenant input/);
    expect(calls).toEqual([]);
    expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
  });

  it("refuses a taken slug or hostname before the QR, the handover or any write", () => {
    const w = world();
    const { db, remote, calls } = fakeRemote();
    db.sqlite.exec("INSERT INTO tenants (id, slug, config_json, r2_prefix, source, created_at, updated_at) VALUES ('d0000000-0000-4000-8000-0000000000d1', 'curso-demo', '{}', 't/d0/', 'pilot_import', 'x', 'x')");
    const { status } = run(w, remote);
    expect(status).toBe(1);
    expect(calls.every((c) => c === "select")).toBe(true);
    expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
  });

  it("refuses a workdir that already has a provisioned tenant", () => {
    const w = world();
    const { remote, calls } = fakeRemote();
    expect(run(w, remote).status).toBe(0);
    const again = fakeRemote();
    expect(run(w, again.remote).status).toBe(1);
    expect(again.calls).toEqual([]);
  });

  it("writes nothing to the database when the QR upload fails, and names the tenant id only", () => {
    const w = world();
    const { db, remote, inserts } = fakeRemote({ failPut: true });
    const { status, out } = run(w, remote);
    expect(status).toBe(1);
    expect(inserts).toEqual([]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 0 });
    expect(out).toContain(TENANT_ID);
    expect(readManifest(w.dir).tenant).toBeUndefined();
  });

  it("reports a partly written tenant without details and does not record it as provisioned", () => {
    const w = world();
    const { remote } = fakeRemote({ failInsertAt: 2 });
    const { status, out } = run(w, remote);
    expect(status).toBe(1);
    expect(out).toMatch(/partly provisioned/);
    expect(out).toContain(TENANT_ID);
    expect(out).not.toMatch(/owner@example|INSERT|tenants/);
    expect(readManifest(w.dir).tenant).toBeUndefined();
  });

  it("fails when the read-back does not match what was written", () => {
    const w = world();
    const { remote } = fakeRemote({ tamper: true });
    const { status } = run(w, remote);
    expect(status).toBe(1);
    expect(readManifest(w.dir).tenant).toBeUndefined();
  });

  it("never prints the token, the address, the owner email or the config in any log line", () => {
    const w = world();
    const { remote } = fakeRemote({ failInsertAt: 3 });
    const { out } = run(w, remote);
    expect(out).not.toMatch(/d-[a-z0-9]{32}|owner@example|schoolName|in\.colegio/i);
  });
});
