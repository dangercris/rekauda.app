import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "./lib/jsonc.mjs";

const repo = new URL("..", import.meta.url).pathname;
const read = (file: string) => parseJsonc(readFileSync(repo + file, "utf8")) as { vars?: Record<string, string>; d1_databases?: Array<{ migrations_dir?: string }>; secrets?: { required?: string[] } };

/** On this branch wrangler.example.jsonc is the self-host template: it must boot the cloud code in single-tenant mode. */
describe("self-host template (wrangler.example.jsonc)", () => {
  const example = read("wrangler.example.jsonc");

  it("runs in single-tenant mode", () => {
    expect(example.vars?.["TENANCY"]).toBe("single");
  });

  it("uses the cloud schema folder", () => {
    expect(example.d1_databases?.map((d) => d.migrations_dir)).toEqual(["migrations-cloud"]);
  });

  it("keeps the self-host secrets and stays distinct from the multi-tenant example", () => {
    expect(example.secrets?.required).toEqual(["ADMIN_PASSWORD", "SESSION_SECRET", "FORWARD_TO"]);
    expect(read("wrangler.cloud.example.jsonc").vars?.["TENANCY"]).toBe("multi");
  });
});
