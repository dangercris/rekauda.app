import { describe, expect, it } from "vitest";
import example from "../../../rekauda.config.example";
import { PlatformDb } from "../data/platform-db";
import { asD1 } from "../test/d1";
import { createCloudTestDb } from "../test/d1-cloud";
import { D1TenantProvisioner } from "./d1-tenant-provisioner";
import { HostTenantResolver } from "./resolver";

const input = { slug: "club-azul", ownerEmail: "Owner@Example.test", config: example };

function setup() {
  const raw = createCloudTestDb();
  const platform = new PlatformDb(asD1(raw));
  return { raw, platform, provisioner: new D1TenantProvisioner(platform, "localhost", () => "2026-11-26T00:00:00.000Z") };
}

describe("D1TenantProvisioner", () => {
  it("creates an active cloud tenant with its prefix, subdomain and owner", async () => {
    const { raw, provisioner, platform } = setup();
    const tenant = await provisioner.provision(input);
    expect(tenant.slug).toBe("club-azul");
    expect(tenant.source).toBe("cloud");
    expect(tenant.r2Prefix).toBe(`t/${tenant.id}/`);
    expect(await platform.findActiveTenantByHostname("club-azul.localhost")).toEqual(tenant);
    expect(await platform.findMemberByEmail(tenant.id, "owner@example.test")).not.toBeNull();
    expect(raw.sqlite.prepare("SELECT role FROM memberships WHERE tenant_id = ?").get(tenant.id)).toEqual({ role: "owner" });
  });

  it("gives every tenant its own id and prefix", async () => {
    const { provisioner } = setup();
    const a = await provisioner.provision(input);
    const b = await provisioner.provision({ ...input, slug: "club-rojo", ownerEmail: "other@example.test" });
    expect(a.id).not.toBe(b.id);
    expect(a.r2Prefix).not.toBe(b.r2Prefix);
  });

  it.each(["www", "ab", "Club-Azul", "club--azul", "-club", "club.azul"])("rejects the slug %s", async (slug) => {
    const { provisioner, raw } = setup();
    await expect(provisioner.provision({ ...input, slug })).rejects.toThrow(/slug/i);
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 0 });
  });

  it("rejects a taken slug without leaving partial rows", async () => {
    const { provisioner, raw } = setup();
    await provisioner.provision(input);
    await expect(provisioner.provision({ ...input, ownerEmail: "second@example.test" })).rejects.toThrow(/slug/i);
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 1 });
    expect(raw.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
  });

  it("rejects an invalid config naming the field", async () => {
    const { provisioner } = setup();
    await expect(provisioner.provision({ ...input, config: { ...example, schoolName: 5 } as never })).rejects.toThrow(/schoolName/);
  });

  it("rejects an invalid owner email", async () => {
    const { provisioner } = setup();
    await expect(provisioner.provision({ ...input, ownerEmail: "not-an-email" })).rejects.toThrow(/email/i);
  });

  it("produces a tenant the host resolver can serve", async () => {
    const { provisioner, platform } = setup();
    const tenant = await provisioner.provision(input);
    const resolved = await new HostTenantResolver(platform, "localhost").resolve("club-azul.localhost");
    expect(resolved).toEqual(tenant);
  });
});
