import { describe, expect, it } from "vitest";
import example from "../../rekauda.config.example";
import type { InstanceConfig } from "./instance-config";
import { monthYearEs, validateInstanceConfig } from "./instance-validation";

const withTreasury = (patch: Partial<InstanceConfig["treasury"]>): InstanceConfig => ({ ...example, treasury: { ...example.treasury, ...patch } });

describe("validateInstanceConfig", () => {
  it("accepts the example config", () => {
    expect(validateInstanceConfig(example)).toBe(example);
  });

  it("rejects an account number the email check cannot use", () => {
    expect(() => validateInstanceConfig(withTreasury({ accountNumber: "123" }))).toThrow(/accountNumber/);
    expect(() => validateInstanceConfig(withTreasury({ accountNumber: "77-0084" }))).toThrow(/accountNumber/);
  });

  it("rejects bad tone, date, analytics id and QR path", () => {
    expect(() => validateInstanceConfig({ ...example, defaultTone: "red" })).toThrow(/defaultTone/);
    expect(() => validateInstanceConfig({ ...example, earliestTransferDate: "2026-13-40" })).toThrow(/earliestTransferDate/);
    expect(() => validateInstanceConfig({ ...example, analytics: { gaMeasurementId: "nope" } })).toThrow(/gaMeasurementId/);
    expect(() => validateInstanceConfig(withTreasury({ qrUrl: "https://elsewhere.test/qr.png" }))).toThrow(/qrUrl/);
  });

  it("rejects an empty or duplicated bank list", () => {
    expect(() => validateInstanceConfig({ ...example, banks: [] })).toThrow(/banks/);
    expect(() => validateInstanceConfig({ ...example, banks: ["A", "A"] })).toThrow(/banks/);
  });
});

describe("monthYearEs", () => {
  it("names the month and year in Spanish", () => {
    expect(monthYearEs("2026-11-01")).toBe("noviembre de 2026");
    expect(monthYearEs("2027-01-15")).toBe("enero de 2027");
  });
});
