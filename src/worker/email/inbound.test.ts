import { describe, expect, it } from "vitest";
import { PlatformDb } from "../data/platform-db";
import { sha256Hex } from "../ids";
import { asD1 } from "../test/d1";
import { TENANT_A, TENANT_B, createCloudTestDb } from "../test/d1-cloud";
import { parseInboundAddress, resolveInboundTenant } from "./inbound";

const DOMAIN = "in.example.test";
const TOKEN_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TOKEN_B = "0f9e8d7c6b5a49382716f5e4d3c2b1a0";

async function setup() {
  const raw = createCloudTestDb({ seed: true });
  const set = raw.sqlite.prepare("UPDATE tenants SET inbound_token_hash = ? WHERE id = ?");
  set.run(await sha256Hex(new TextEncoder().encode(TOKEN_A)), TENANT_A);
  set.run(await sha256Hex(new TextEncoder().encode(TOKEN_B)), TENANT_B);
  return { raw, platform: new PlatformDb(asD1(raw)) };
}

describe("parseInboundAddress", () => {
  it("extracts the token of d-<token>@<inbound domain>, normalising case and a trailing dot", () => {
    expect(parseInboundAddress(`d-${TOKEN_A}@${DOMAIN}`, DOMAIN)).toBe(TOKEN_A);
    expect(parseInboundAddress(`D-${TOKEN_A.toUpperCase()}@IN.Example.TEST.`, DOMAIN)).toBe(TOKEN_A);
  });

  it.each([
    ["another domain", `d-${TOKEN_A}@other.example.test`],
    ["a sub-domain of the inbound domain", `d-${TOKEN_A}@x.${DOMAIN}`],
    ["a plus-addressing variant", `d-${TOKEN_A}+news@${DOMAIN}`],
    ["a missing prefix", `${TOKEN_A}@${DOMAIN}`],
    ["a short token", `d-abc@${DOMAIN}`],
    ["an over-long token", `d-${"a".repeat(65)}@${DOMAIN}`],
    ["a non alphanumeric token", `d-${TOKEN_A.slice(0, 20)}_-..@${DOMAIN}`],
    ["two at signs", `d-${TOKEN_A}@x@${DOMAIN}`],
    ["a display name form", `Name <d-${TOKEN_A}@${DOMAIN}>`],
    ["a control character", `d-${TOKEN_A}\r\n@${DOMAIN}`],
    ["an empty value", ""],
    ["a Kelvin sign that lowercases to k", `d-\u212a${TOKEN_A.slice(1)}@${DOMAIN}`],
    ["a non-ASCII domain look-alike", `d-${TOKEN_A}@\u0130n.example.test`],
  ])("rejects %s", (_name, address) => {
    expect(parseInboundAddress(address, DOMAIN)).toBeNull();
  });
});

describe("resolveInboundTenant", () => {
  it("routes each token to its own tenant", async () => {
    const { platform } = await setup();
    expect((await resolveInboundTenant(`d-${TOKEN_A}@${DOMAIN}`, DOMAIN, platform))?.id).toBe(TENANT_A);
    expect((await resolveInboundTenant(`d-${TOKEN_B}@${DOMAIN}`, DOMAIN, platform))?.id).toBe(TENANT_B);
  });

  it("returns null for an unknown token, a foreign domain and a suspended tenant", async () => {
    const { raw, platform } = await setup();
    expect(await resolveInboundTenant(`d-${"0".repeat(32)}@${DOMAIN}`, DOMAIN, platform)).toBeNull();
    expect(await resolveInboundTenant(`d-${TOKEN_A}@other.example.test`, DOMAIN, platform)).toBeNull();
    raw.sqlite.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(TENANT_A);
    expect(await resolveInboundTenant(`d-${TOKEN_A}@${DOMAIN}`, DOMAIN, platform)).toBeNull();
  });

  it("does not touch the database for an address that cannot be a token", async () => {
    const calls: string[] = [];
    const platform = { findActiveTenantByInboundTokenHash: async (h: string) => (calls.push(h), null) } as unknown as PlatformDb;
    await resolveInboundTenant(`d-${TOKEN_A}+x@${DOMAIN}`, DOMAIN, platform);
    expect(calls).toEqual([]);
  });

  it("looks up the hash, never the token itself", async () => {
    const calls: string[] = [];
    const platform = { findActiveTenantByInboundTokenHash: async (h: string) => (calls.push(h), null) } as unknown as PlatformDb;
    await resolveInboundTenant(`d-${TOKEN_A}@${DOMAIN}`, DOMAIN, platform);
    expect(calls).toEqual([await sha256Hex(new TextEncoder().encode(TOKEN_A))]);
  });
});
