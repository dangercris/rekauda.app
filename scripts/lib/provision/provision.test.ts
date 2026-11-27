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
import { prepareProvision, readOwnerState, runProvision } from "./provision.mjs";
// @ts-expect-error plain .mjs module without types
import { runUndo } from "../import/undo.mjs";
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
const OWNER_ID = "e0000000-0000-4000-8000-0000000000e1";
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
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "qr-")));
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

  it("rejects a path that goes through a symlinked directory, even when the file itself is real", () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), "qr-real-")));
    dirs.push(real);
    writeFileSync(join(real, "q.png"), PNG);
    const link = real + "-link";
    symlinkSync(real, link);
    dirs.push(link);
    expect(() => readQr(join(link, "q.png"))).toThrow(/invalid QR image/);
    expect(readQr(join(real, "q.png"))).toMatchObject({ ext: "png" });
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
function fakeRemote(over: { failPut?: boolean; failInsertAt?: number; tamper?: boolean; tamperConfig?: boolean } = {}) {
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
      if (over.tamperConfig && sql.startsWith("INSERT INTO tenants")) db.sqlite.exec(`UPDATE tenants SET config_json = '{"other":1}'`);
    },
    put: (spec: { tenantId: string; ext: string; contentType: string; file: string }) => {
      calls.push("put");
      if (over.failPut) throw new Error("remote command failed");
      puts.push({ tenantId: spec.tenantId, ext: spec.ext, contentType: spec.contentType, bytes: readFileSync(spec.file), mode: statSync(spec.file).mode & 0o777 });
    },
  };
  return { db, remote, calls, puts, inserts };
}

function run(w: ReturnType<typeof world>, remote: unknown, extra: Record<string, unknown> = {}, reuseOwner = false) {
  const out: string[] = [];
  const log = { error: (m: string) => out.push(String(m)), warn: (m: string) => out.push(String(m)), log: (m: string) => out.push(String(m)) };
  const { manifest } = { manifest: readManifest(w.dir) };
  const prepared = prepareProvision(w.dir);
  const status = runProvision({ dir: w.dir, manifest, tenantId: TENANT_ID, ownerId: OWNER_ID, reuseOwner, slug: prepared.input.slug, prepared }, { remote, log, target: TARGET, now: () => "2026-11-27T00:00:00Z", ...extra }) as number;
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
    expect(readManifest(w.dir).tenant).toEqual({ id: TENANT_ID, slug: "curso-demo", state: "provisioned" });
    expect(existsSync(join(w.dir, "provision.lock"))).toBe(false);
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
    expect(readManifest(w.dir).tenant).toMatchObject({ id: TENANT_ID, state: "provisioning" });
    expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
  });

  it("reports a partly written tenant without details and does not record it as provisioned", () => {
    const w = world();
    const { remote } = fakeRemote({ failInsertAt: 2 });
    const { status, out } = run(w, remote);
    expect(status).toBe(1);
    expect(out).toMatch(/partly provisioned/);
    expect(out).toContain(TENANT_ID);
    expect(out).not.toMatch(/owner@example|INSERT|tenants/);
    expect(readManifest(w.dir).tenant).toMatchObject({ state: "provisioning" });
    expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
    expect(existsSync(join(w.dir, "provision.lock"))).toBe(false);
  });

  it("fails when the read-back does not match what was written", () => {
    const w = world();
    const { remote } = fakeRemote({ tamper: true });
    const { status } = run(w, remote);
    expect(status).toBe(1);
    expect(readManifest(w.dir).tenant).toMatchObject({ state: "provisioning" });
    expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
  });

  it("fails when the stored config_json differs from what was inserted", () => {
    const w = world();
    const { status } = run(w, fakeRemote({ tamperConfig: true }).remote);
    expect(status).toBe(1);
    expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
  });

  it("records the provisioning state before the first remote write, atomically", () => {
    const w = world();
    const { remote } = fakeRemote();
    const seen: unknown[] = [];
    const spy = { ...remote, put: (spec: never) => (seen.push(readManifest(w.dir).tenant), (remote.put as (s: never) => void)(spec)) };
    run(w, spy);
    expect(seen).toEqual([{ id: TENANT_ID, slug: "curso-demo", state: "provisioning" }]);
  });

  it("a rerun after an unfinished attempt refuses and points at the undo, touching nothing", () => {
    const w = world();
    run(w, fakeRemote({ failInsertAt: 2 }).remote);
    const again = fakeRemote();
    const { status, out } = run(w, again.remote);
    expect(status).toBe(1);
    expect(out).toMatch(/prod:undo-tenant/);
    expect(again.calls).toEqual([]);
  });

  it("refuses while provision.lock exists and leaves that file alone", () => {
    const w = world();
    writeFileSync(join(w.dir, "provision.lock"), "");
    const { remote, calls } = fakeRemote();
    const { status, out } = run(w, remote);
    expect(status).toBe(1);
    expect(out).toMatch(/provision\.lock/);
    expect(calls).toEqual([]);
    expect(existsSync(join(w.dir, "provision.lock"))).toBe(true);
  });

  it("refuses an owner email that belongs to a system account before any write", () => {
    const w = world();
    const { db, remote, calls } = fakeRemote();
    db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-sys', 'owner@example.test', 'synthetic', 'x')");
    const { status, out } = run(w, remote);
    expect(status).toBe(1);
    expect(calls.every((c) => c === "select")).toBe(true);
    expect(out).not.toMatch(/owner@example/);
    expect(readManifest(w.dir).tenant).toBeUndefined();
  });

  it("refuses an existing person as owner unless reuse was typed, and then reuses that account", () => {
    const w = world();
    const first = fakeRemote();
    first.db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-old', 'owner@example.test', 'person', 'x')");
    const refused = run(w, first.remote);
    expect(refused.status).toBe(1);
    expect(refused.out).not.toMatch(/owner@example/);
    expect(first.calls.every((c) => c === "select")).toBe(true);
    const ok = run(w, first.remote, {}, true);
    expect(ok.status).toBe(0);
    expect(first.db.sqlite.prepare("SELECT user_id FROM memberships").get()).toEqual({ user_id: "u-old" });
  });

  it("records the reused owner in the manifest atomically with the tenant state, and a new owner leaves no such field", () => {
    const reused = world();
    const first = fakeRemote();
    first.db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-old', 'owner@example.test', 'person', 'x')");
    expect(run(reused, first.remote, {}, true).status).toBe(0);
    expect(readManifest(reused.dir).tenant).toEqual({ id: TENANT_ID, slug: "curso-demo", state: "provisioned", reusedOwnerId: "u-old" });
    const failed = world();
    const broken = fakeRemote({ failInsertAt: 1 });
    broken.db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-old', 'owner@example.test', 'person', 'x')");
    expect(run(failed, broken.remote, {}, true).status).toBe(1);
    expect(readManifest(failed.dir).tenant).toEqual({ id: TENANT_ID, slug: "curso-demo", state: "provisioning", reusedOwnerId: "u-old" });
    const fresh = world();
    expect(run(fresh, fakeRemote().remote).status).toBe(0);
    expect(readManifest(fresh.dir).tenant).toEqual({ id: TENANT_ID, slug: "curso-demo", state: "provisioned" });
  });

  describe("undo-tenant after provisioning", () => {
    const undoOf = (w: ReturnType<typeof world>, fake: ReturnType<typeof fakeRemote>) => {
      const remote = { select: fake.remote.select, mutate: (q: string) => fake.db.sqlite.exec(q) };
      const log = { error: () => {}, warn: () => {}, log: () => {} };
      return runUndo({ dir: w.dir, manifest: readManifest(w.dir), tenantId: TENANT_ID, slug: "curso-demo", tenantLevel: true }, { remote, log }) as number;
    };
    const users = (fake: ReturnType<typeof fakeRemote>) => (fake.db.sqlite.prepare("SELECT id FROM users ORDER BY id").all() as { id: string }[]).map((r) => r.id);

    it("never deletes an existing person that had no membership before and was reused as owner", () => {
      const w = world();
      const fake = fakeRemote();
      fake.db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-old', 'owner@example.test', 'person', 'x')");
      expect(run(w, fake.remote, {}, true).status).toBe(0);
      expect(undoOf(w, fake)).toBe(0);
      expect(users(fake)).toEqual(["u-old"]);
      expect(fake.db.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 0 });
      expect(readManifest(w.dir).tenant).toBeUndefined();
    });

    it("an account registered with the owner email after the read is refused at read-back, recorded for undo, and kept by undo", () => {
      const w = world();
      const fake = fakeRemote();
      const racing = {
        ...fake.remote,
        insert: (sql: string) => {
          if (sql.startsWith("INSERT INTO tenants")) fake.db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-race', 'owner@example.test', 'person', 'x')");
          fake.remote.insert(sql);
        },
      };
      const { status, out } = run(w, racing);
      expect(status).toBe(1);
      expect(out).toMatch(/was registered with the owner email/i);
      expect(out).not.toMatch(/owner@example/);
      expect(readManifest(w.dir).tenant).toEqual({ id: TENANT_ID, slug: "curso-demo", state: "provisioning", reusedOwnerId: "u-race" });
      expect(existsSync(join(w.dir, "handover.txt"))).toBe(false);
      expect(undoOf(w, fake)).toBe(0);
      expect(users(fake)).toEqual(["u-race"]);
    });

    it("deletes an owner that provisioning created", () => {
      const w = world();
      const fake = fakeRemote();
      expect(run(w, fake.remote).status).toBe(0);
      expect(users(fake)).toEqual([OWNER_ID]);
      expect(undoOf(w, fake)).toBe(0);
      expect(users(fake)).toEqual([]);
    });
  });

  it("prints the reused owner id (never the email) in the success line, and nothing extra for a new owner", () => {
    const reused = world();
    const first = fakeRemote();
    first.db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u-old', 'owner@example.test', 'person', 'x')");
    const a = run(reused, first.remote, {}, true);
    expect(a.out).toMatch(/reusedOwnerId=u-old/);
    expect(a.out).not.toMatch(/owner@example/);
    expect(run(world(), fakeRemote().remote).out).not.toMatch(/reusedOwnerId/);
  });

  it("refuses the reuse phrase when there is no existing account", () => {
    const w = world();
    const { remote, calls } = fakeRemote();
    expect(run(w, remote, {}, true).status).toBe(1);
    expect(calls.every((c) => c === "select")).toBe(true);
  });

  it("readOwnerState tells none, person and synthetic apart", () => {
    const { db, remote } = fakeRemote();
    expect(readOwnerState(remote, "a@example.test")).toBe("none");
    db.sqlite.exec("INSERT INTO users (id, email, kind, created_at) VALUES ('u1', 'a@example.test', 'person', 'x'), ('u2', 'b@example.test', 'synthetic', 'x')");
    expect(readOwnerState(remote, "A@example.test")).toBe("person");
    expect(readOwnerState(remote, "b@example.test")).toBe("synthetic");
  });

  it("never prints the token, the address, the owner email or the config in any log line", () => {
    const w = world();
    const { remote } = fakeRemote({ failInsertAt: 3 });
    const { out } = run(w, remote);
    expect(out).not.toMatch(/d-[a-z0-9]{32}|owner@example|schoolName|in\.colegio/i);
  });
});
