import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module without types
import { cleanupWorkdir, createWorkdir, openWorkdir } from "./private-workdir.mjs";

const scratch: string[] = [];
const fresh = (base: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${base}-`)));
  scratch.push(dir);
  return dir;
};
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const mode = (path: string): number => statSync(path).mode & 0o777;

describe("createWorkdir", () => {
  it("makes a 0700 directory with a 0600 marker under the given tmp, outside the repo", () => {
    const tmp = fresh("wd-tmp");
    const root = fresh("wd-repo");
    const dir = createWorkdir({ root: root + "/", tmp, now: () => "2026-11-27T00:00:00.000Z" });
    expect(realpathSync(dir)).toBe(dir);
    expect(dir.startsWith(join(tmp, "rekauda-pilot-"))).toBe(true);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, "manifest.json"))).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))).toMatchObject({ marker: "rekauda-pilot-workdir", exports: [] });
  });

  it("refuses, and leaves nothing behind, when the tmp dir is inside the repo", () => {
    const root = fresh("wd-repo");
    const tmp = join(root, "inside");
    mkdirSync(tmp);
    expect(() => createWorkdir({ root: root + "/", tmp })).toThrow(/outside the repository/);
    expect(existsSync(tmp) && statSync(tmp).isDirectory()).toBe(true);
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe("openWorkdir", () => {
  const setup = () => {
    const tmp = fresh("wd-tmp");
    const root = fresh("wd-repo") + "/";
    return { tmp, root, dir: createWorkdir({ root, tmp }) as string };
  };

  it("accepts a workdir it created", () => {
    const { tmp, root, dir } = setup();
    expect(openWorkdir(dir, { root, tmp }).dir).toBe(dir);
  });

  it.each([
    ["without the marker", (dir: string) => rmSync(join(dir, "manifest.json"))],
    ["with a different marker", (dir: string) => writeFileSync(join(dir, "manifest.json"), JSON.stringify({ marker: "other" }))],
    ["with broken JSON in the marker", (dir: string) => writeFileSync(join(dir, "manifest.json"), "{")],
    ["with group or world access", (dir: string) => chmodSync(dir, 0o755)],
  ])("refuses a directory %s", (_label, break_) => {
    const { tmp, root, dir } = setup();
    break_(dir);
    expect(() => openWorkdir(dir, { root, tmp })).toThrow();
  });

  it("refuses a symlink, a directory outside tmp, a wrong name and a relative path", () => {
    const { tmp, root, dir } = setup();
    const link = join(tmp, "rekauda-pilot-link");
    symlinkSync(dir, link);
    expect(() => openWorkdir(link, { root, tmp })).toThrow();
    const other = fresh("wd-other");
    writeFileSync(join(other, "manifest.json"), JSON.stringify({ marker: "rekauda-pilot-workdir", version: 1, exports: [] }));
    chmodSync(other, 0o700);
    expect(() => openWorkdir(other, { root, tmp })).toThrow();
    expect(() => openWorkdir(join(tmp, "plain"), { root, tmp })).toThrow();
    expect(() => openWorkdir("rekauda-pilot-x", { root, tmp })).toThrow();
  });
});

describe("cleanupWorkdir", () => {
  it("removes a marked workdir with its content", () => {
    const tmp = fresh("wd-tmp");
    const root = fresh("wd-repo") + "/";
    const dir = createWorkdir({ root, tmp }) as string;
    writeFileSync(join(dir, "export-1.json"), "{}");
    cleanupWorkdir(dir, { root, tmp });
    expect(existsSync(dir)).toBe(false);
  });

  it("deletes nothing when there is no marker, or when given a symlink to a marked workdir", () => {
    const tmp = fresh("wd-tmp");
    const root = fresh("wd-repo") + "/";
    const plain = join(tmp, "rekauda-pilot-plain");
    mkdirSync(plain, { mode: 0o700 });
    writeFileSync(join(plain, "keep.txt"), "x");
    expect(() => cleanupWorkdir(plain, { root, tmp })).toThrow();
    expect(existsSync(join(plain, "keep.txt"))).toBe(true);
    const real = createWorkdir({ root, tmp }) as string;
    const link = join(tmp, "rekauda-pilot-link");
    symlinkSync(real, link);
    expect(() => cleanupWorkdir(link, { root, tmp })).toThrow();
    expect(existsSync(join(real, "manifest.json"))).toBe(true);
  });
});
