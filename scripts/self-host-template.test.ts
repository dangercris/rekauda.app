import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "./lib/jsonc.mjs";

const repo = new URL("..", import.meta.url).pathname;
const read = (file: string) => parseJsonc(readFileSync(repo + file, "utf8")) as { vars?: Record<string, string>; d1_databases?: Array<{ migrations_dir?: string }>; secrets?: { required?: string[] }; assets?: { run_worker_first?: string[] } };

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
    expect(example.secrets?.required).toEqual(["ADMIN_PASSWORD", "FORWARD_TO"]);
    expect(read("wrangler.cloud.example.jsonc").vars?.["TENANCY"]).toBe("multi");
  });
});

/** Cloudflare semantics: a path runs the Worker first when it matches a positive rule and no `!` rule. `*` matches any characters. */
function workerFirst(rules: string[], path: string): boolean {
  const matches = (rule: string) => new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);
  const excluded = rules.filter((r) => r.startsWith("!")).some((r) => matches(r.slice(1)));
  return !excluded && rules.filter((r) => !r.startsWith("!")).some(matches);
}

describe("multi-tenant example run_worker_first", () => {
  const rules = read("wrangler.cloud.example.jsonc").assets?.run_worker_first ?? [];

  it.each(["/", "/admin", "/admin/acceso", "/r/demo-collection", "/index.html", "/admin.html", "/api/config", "/api/assets/deuna-qr.png", "/api/og/demo-collection.png"])(
    "runs the Worker first for %s, so every HTML entry gets its tenant's config",
    (path) => expect(workerFirst(rules, path)).toBe(true),
  );

  it.each(["/assets/index-4f2a9c.js", "/assets/admin-91bc.css", "/icon.svg"])(
    "keeps %s static",
    (path) => expect(workerFirst(rules, path)).toBe(false),
  );
});
