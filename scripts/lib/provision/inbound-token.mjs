// The inbound mail token of a tenant: minted here, only its SHA-256 goes to the database, and the address that contains it
// is handed over through a private file (0600 in the 0700 workdir). Nothing here prints. No dependencies.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

const TOKEN = /^[a-z0-9]{16,64}$/;
export const HANDOVER_FILE = "handover.txt";

/** 16 random bytes as 32 lowercase hex characters. `hash` is the sha256 hex of its UTF-8 bytes, the same as the Worker's sha256Hex. */
export function mintToken(inboundDomain, random = randomBytes) {
  const token = random(16).toString("hex");
  if (!TOKEN.test(token)) throw new Error("bad token");
  return { token, hash: createHash("sha256").update(token, "utf8").digest("hex"), address: `d-${token}@${inboundDomain}` };
}

/** Writes the address through a temp file created exclusively (0600), then renames it into place. Returns the file path. */
export function writeHandover(dir, address) {
  const file = join(dir, HANDOVER_FILE);
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeSync(fd, `${address}\n`);
    closeSync(fd);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return file;
}
