// The Deuna QR image of a tenant: read from a local file, checked by its magic bytes (png, jpg, webp) and a 1 MB limit, then
// staged as a private copy named deuna-qr.<ext> that the fixed upload reads. Every problem is one generic error. No dependencies.
import { chmodSync, closeSync, constants, fstatSync, mkdtempSync, openSync, readSync, realpathSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const MAX_QR_BYTES = 1024 * 1024;
export const QR_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

const startsWith = (bytes, signature, at = 0) => signature.every((b, i) => bytes[at + i] === b);

function extensionOf(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return undefined;
}

/**
 * Returns { bytes, ext, contentType } for a plain file of 1 to 1 MB with image magic bytes, or throws `invalid QR image`. No symlink anywhere in
 * the path (the real path must equal the given one) and the file is opened with O_NOFOLLOW and read from that same descriptor.
 */
export function readQr(path) {
  try {
    if (realpathSync(path) !== path) throw new Error("x");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      const size = stat.size;
      if (!stat.isFile() || size < 1 || size > MAX_QR_BYTES) throw new Error("x");
      const bytes = Buffer.alloc(size);
      for (let read = 0; read < size; ) {
        const n = readSync(fd, bytes, read, size - read, null);
        if (n === 0) throw new Error("x");
        read += n;
      }
      const ext = extensionOf(bytes);
      if (!ext) throw new Error("x");
      return { bytes, ext, contentType: QR_TYPES[ext] };
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new Error("invalid QR image");
  }
}

/** Writes the bytes to <dir>/qr-XXXX/deuna-qr.<ext> (dir 0700, file 0600, exclusive). The caller removes copyDir. */
export function stageQr(dir, bytes, ext) {
  const copyDir = mkdtempSync(join(dir, "qr-"));
  try {
    chmodSync(copyDir, 0o700);
    const file = join(copyDir, `deuna-qr.${ext}`);
    const fd = openSync(file, "wx", 0o600);
    try {
      writeSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
    return { copyDir, file };
  } catch (error) {
    rmSync(copyDir, { recursive: true, force: true });
    throw error;
  }
}
