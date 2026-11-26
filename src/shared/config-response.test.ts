import { describe, expect, it } from "vitest";
import type { ConfigResponse } from "./api";
import { parseConfigResponse } from "./config-response";

const valid: ConfigResponse = {
  className: "2.º de Bachillerato B",
  schoolName: "Colegio Ficticio",
  classShortName: "2.º Bach. B",
  classMark: "2B",
  banks: ["Banco Uno", "Banco Dos"],
  treasury: {
    bank: "Banco Uno",
    accountType: "Cuenta corriente",
    accountNumber: "1234567890",
    holder: "Titular Ficticio",
    holderId: "0100000001",
    deunaUrl: null,
    qrUrl: "/api/assets/deuna-qr.png?v=3",
    helpUrl: "https://example.org/ayuda",
  },
  earliestTransferDate: "2026-09-01",
  defaultTone: "#0B7A73",
  analytics: { gaMeasurementId: "G-ABCD1234" },
  auth: { mode: "magic_link" },
};

const mutate = (change: (copy: Record<string, any>) => void): unknown => {
  const copy = structuredClone(valid) as unknown as Record<string, any>;
  change(copy);
  return copy;
};

describe("parseConfigResponse", () => {
  it("accepts a full response and keeps the qr path and the auth mode", () => {
    expect(parseConfigResponse(valid, "boot")).toEqual(valid);
  });

  it("accepts a response without qr, links or analytics id", () => {
    const raw = mutate((c) => {
      c["treasury"].qrUrl = null;
      c["analytics"].gaMeasurementId = null;
    });
    const parsed = parseConfigResponse(raw, "boot");
    expect(parsed.treasury.qrUrl).toBeNull();
    expect(parsed.analytics.gaMeasurementId).toBeNull();
  });

  it("drops fields it does not know", () => {
    const parsed = parseConfigResponse(mutate((c) => { c["secret"] = "x"; c["treasury"].token = "y"; }), "boot");
    expect(parsed).toEqual(valid);
  });

  it.each([
    ["protocol-relative qr", (c: Record<string, any>) => { c["treasury"].qrUrl = "//elsewhere.example/q.png"; }, /treasury\.qrUrl/],
    ["backslash qr", (c: Record<string, any>) => { c["treasury"].qrUrl = "/\\elsewhere.example"; }, /treasury\.qrUrl/],
    ["absolute qr", (c: Record<string, any>) => { c["treasury"].qrUrl = "https://elsewhere.example/q.png"; }, /treasury\.qrUrl/],
    ["unknown auth mode", (c: Record<string, any>) => { c["auth"].mode = "sso"; }, /auth\.mode/],
    ["missing auth", (c: Record<string, any>) => { delete c["auth"]; }, /auth/],
    ["missing class name", (c: Record<string, any>) => { delete c["className"]; }, /className/],
    ["bad tone", (c: Record<string, any>) => { c["defaultTone"] = "red"; }, /defaultTone/],
  ])("rejects %s by field name", (_name, change, field) => {
    expect(() => parseConfigResponse(mutate(change), "boot")).toThrow(field);
  });

  it("caps the bank list at 50 names", () => {
    const banks = (n: number) => Array.from({ length: n }, (_, i) => `Banco ${i}`);
    expect(parseConfigResponse(mutate((c) => { c["banks"] = banks(50); }), "boot").banks).toHaveLength(50);
    expect(() => parseConfigResponse(mutate((c) => { c["banks"] = banks(51); }), "boot")).toThrow(/banks/);
  });

  it("rejects non-objects", () => {
    expect(() => parseConfigResponse(null, "boot")).toThrow(/config/);
    expect(() => parseConfigResponse("{}", "boot")).toThrow(/config/);
  });
});
