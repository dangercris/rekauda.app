import { afterEach, describe, expect, it } from "vitest";
import { tenantA, tenantB } from "../../test/tenants";
import { BOOT_SCRIPT_ID, readBootConfig } from "./boot";

function addTag(json: string, type = "application/json"): HTMLScriptElement {
  const tag = document.createElement("script");
  tag.type = type;
  tag.id = BOOT_SCRIPT_ID;
  tag.textContent = json;
  document.head.appendChild(tag);
  return tag;
}

afterEach(() => {
  document.getElementById(BOOT_SCRIPT_ID)?.remove();
});

describe("readBootConfig", () => {
  it("reads and validates the boot JSON of the page", () => {
    addTag(JSON.stringify(tenantA));
    expect(readBootConfig()?.schoolName).toBe("Colegio Aurora");
  });

  it("reads another tenant's values, not a fixed one", () => {
    addTag(JSON.stringify(tenantB));
    expect(readBootConfig()?.treasury.accountNumber).toBe("0000000022");
  });

  it("decodes the escapes the Worker adds", () => {
    addTag(JSON.stringify({ ...tenantA, className: "A < B" }).replace(/</g, "\\u003c"));
    expect(readBootConfig()?.className).toBe("A < B");
  });

  it("returns null when the tag is missing", () => {
    expect(readBootConfig()).toBeNull();
  });

  it("returns null for a tag that is not JSON", () => {
    addTag("{not json");
    expect(readBootConfig()).toBeNull();
  });

  it("returns null when the JSON fails validation", () => {
    addTag(JSON.stringify({ ...tenantA, defaultTone: "red" }));
    expect(readBootConfig()).toBeNull();
  });

  it("ignores an oversized tag without parsing it", () => {
    addTag(`${JSON.stringify(tenantA)}${" ".repeat(64 * 1024)}`);
    expect(readBootConfig()).toBeNull();
  });

  it("ignores a tag that is not a JSON data block", () => {
    addTag(JSON.stringify(tenantA), "text/plain");
    expect(readBootConfig()).toBeNull();
  });
});
