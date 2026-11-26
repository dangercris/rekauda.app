import { describe, expect, it } from "vitest";
import example from "../../rekauda.config.example";
import { resolveInstance } from "./instance";
import { parseInstanceConfig } from "./instance-validation";

describe("resolveInstance", () => {
  it("validates the config it is given and derives the transfer-date label", () => {
    const instance = resolveInstance(example);
    expect(instance.schoolName).toBe(example.schoolName);
    expect(instance.earliestTransferLabel).toBe("noviembre de 2026");
  });

  it("is a pure function of its argument: two configs give two independent instances", () => {
    const a = resolveInstance({ ...example, schoolName: "School A", earliestTransferDate: "2027-01-10" });
    const b = resolveInstance({ ...example, schoolName: "School B" });
    expect([a.schoolName, a.earliestTransferLabel]).toEqual(["School A", "enero de 2027"]);
    expect([b.schoolName, b.earliestTransferLabel]).toEqual(["School B", "noviembre de 2026"]);
  });

  it("fails fast naming the field", () => {
    expect(() => resolveInstance({ ...example, defaultTone: "red" })).toThrow(/defaultTone/);
  });
});

describe("parseInstanceConfig (untrusted JSON)", () => {
  it("accepts a full config and keeps only the known fields", () => {
    const parsed = parseInstanceConfig({ ...example, inboundTokenHash: "secret", treasury: { ...example.treasury, apiKey: "secret" } }, "tenant config");
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(parsed.treasury.accountNumber).toBe(example.treasury.accountNumber);
  });

  it.each([null, "text", 7, [], {}])("rejects a non-config value %j", (value) => {
    expect(() => parseInstanceConfig(value, "tenant config")).toThrow(/tenant config/);
  });

  it.each([
    ["treasury", { ...example, treasury: undefined }],
    ["analytics", { ...example, analytics: null }],
    ["banks", { ...example, banks: "Banco" }],
    ["classMark", { ...example, classMark: 5 }],
  ])("names %s when it is missing or has the wrong type", (field, value) => {
    expect(() => parseInstanceConfig(value, "tenant config")).toThrow(new RegExp(field.replace(".", "\\.")));
  });

  it("treats the optional keys as null when missing and ignores qrUrl entirely (it is derived from the store)", () => {
    const { qrUrl: _q, deunaUrl: _d, helpUrl: _h, ...bare } = example.treasury;
    const parsed = parseInstanceConfig({ ...example, treasury: { ...bare, qrUrl: "https://elsewhere.test/x.png" }, analytics: {} }, "tenant config");
    expect(parsed.treasury).toMatchObject({ qrUrl: null, deunaUrl: null, helpUrl: null });
    expect(parsed.analytics.gaMeasurementId).toBeNull();
    expect(() => parseInstanceConfig({ ...example, treasury: { ...bare, deunaUrl: 7 } }, "tenant config")).toThrow(/treasury\.deunaUrl/);
  });

  it.each([
    ["schoolName", { ...example, schoolName: "A\u0000B" }],
    ["className", { ...example, className: "A\u202EB" }],
    ["banks", { ...example, banks: ["Bank\u2066x"] }],
    ["treasury.holder", { ...example, treasury: { ...example.treasury, holder: "Tab\tHere" } }],
    ["treasury.helpUrl", { ...example, treasury: { ...example.treasury, helpUrl: "https://a.test/\u0007" } }],
  ])("rejects control and bidi characters in %s", (field, value) => {
    expect(() => parseInstanceConfig(value, "tenant config")).toThrow(new RegExp(field.replace(".", "\\.")));
  });

  it("caps URLs at 2048, account numbers at 32 and the analytics id", () => {
    const long = `https://a.test/${"x".repeat(2040)}`;
    expect(() => parseInstanceConfig({ ...example, treasury: { ...example.treasury, helpUrl: long } }, "tenant config")).toThrow(/helpUrl/);
    expect(() => parseInstanceConfig({ ...example, treasury: { ...example.treasury, accountNumber: "1".repeat(33) } }, "tenant config")).toThrow(/accountNumber/);
    expect(() => parseInstanceConfig({ ...example, analytics: { gaMeasurementId: `G-${"A".repeat(40)}` } }, "tenant config")).toThrow(/gaMeasurementId/);
  });

  it("caps every text field so a tenant cannot ship megabytes into every page", () => {
    expect(() => parseInstanceConfig({ ...example, schoolName: "x".repeat(201) }, "tenant config")).toThrow(/schoolName/);
    expect(() => parseInstanceConfig({ ...example, banks: ["y".repeat(201)] }, "tenant config")).toThrow(/banks/);
  });
});
