import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
const exists = (ref: string) => git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).status === 0;
/** The tracker branch when present, otherwise main. Never skipped: with neither, the test fails loudly. */
const base = ["feat/cloud", "main"].find(exists);

describe("pilot migrations are untouched", () => {
  it("has a base ref to compare against", () => {
    expect(base, "neither feat/cloud nor main exists locally: fetch one so migrations/ can be compared").toBeDefined();
  });

  it("has no diff against the base branch in migrations/", () => {
    const diff = git("diff", base ?? "HEAD", "--", "migrations/");
    expect(diff.status).toBe(0);
    expect(diff.stdout).toBe("");
  });

  it("never reuses a pilot migration filename for the cloud schema", () => {
    const pilot = new Set(readdirSync(root + "migrations"));
    expect(pilot.size).toBeGreaterThan(0);
    for (const file of readdirSync(root + "migrations-cloud")) expect(pilot.has(file), file).toBe(false);
  });
});
