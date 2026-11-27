// Private working directory for one pilot migration: created once by pilot:export, reused by the import, validation and
// provisioning steps, and removed only by pilot:cleanup. It holds personal data, so it is mode 0700, owned by the
// current user, lives directly under the OS tmp dir (never inside the repository) and carries a marker file.
// Nothing here prints a path or a value. No dependencies.
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

const PREFIX = "rekauda-pilot-";
const MARKER = "rekauda-pilot-workdir";
const MANIFEST = "manifest.json";

const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** Creates the workdir and its manifest. `root` is the repo root (ends with a slash). Removes it again if it ends up inside the repo. */
export function createWorkdir({ root, tmp, now = () => new Date().toISOString() }) {
  const dir = mkdtempSync(join(realpathSync(tmp), PREFIX));
  try {
    chmodSync(dir, 0o700);
    if (inside(realpathSync(dir), realpathSync(root))) throw new Error("the workdir would be inside the repository");
    const manifest = { marker: MARKER, version: 1, createdAt: now(), exports: [] };
    writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(error.message.includes("repository") ? "the tmp dir must be outside the repository" : "could not create the private workdir");
  }
  return dir;
}

export const readManifest = (dir) => JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
export const writeManifest = (dir, manifest) => writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600 });

/** Validates a workdir (marker, mode, owner, location, no symlink). Returns { dir, manifest } or throws a generic error. */
export function openWorkdir(path, { root, tmp }) {
  const refuse = () => {
    throw new Error("not a valid pilot workdir");
  };
  if (typeof path !== "string" || !isAbsolute(path) || !basename(path).startsWith(PREFIX)) refuse();
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) refuse();
  const real = realpathSync(path);
  if (real !== path || dirname(real) !== realpathSync(tmp) || inside(real, realpathSync(root))) refuse();
  if ((stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) refuse();
  let manifest;
  try {
    manifest = readManifest(real);
  } catch {
    refuse();
  }
  if (manifest?.marker !== MARKER || manifest.version !== 1 || !Array.isArray(manifest.exports)) refuse();
  return { dir: real, manifest };
}

/** Removes a workdir, only if it passes every check of openWorkdir. */
export function cleanupWorkdir(path, ctx) {
  const { dir } = openWorkdir(path, ctx);
  rmSync(dir, { recursive: true, force: true });
}
