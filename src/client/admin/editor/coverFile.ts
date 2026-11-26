/**
 * Cover file preparation: accepts any image the browser can decode, re-encodes big photos and
 * non-JPEG/PNG/WEBP formats (HEIC) to JPEG so the upload fits the Worker's 5 MB / type limits.
 */
import { COVER_TYPES, ImageProcessingError, MAX_UPLOAD_BYTES, compressImage, needsCompression } from "../../lib/image";

export const COVER_ACCEPT = [...COVER_TYPES, "image/heic", "image/heif", ".heic", ".heif"].join(",");

export class CoverError extends Error {
  override readonly name = "CoverError";
}

export function isImageFile(file: Pick<File, "type" | "name">): boolean {
  return file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

export async function prepareCover(file: File): Promise<File> {
  if (!isImageFile(file)) throw new CoverError("La portada debe ser una imagen JPG, PNG o WEBP.");
  let ready = file;
  if (needsCompression(file) || file.size > MAX_UPLOAD_BYTES) {
    try {
      ready = await compressImage(file, { maxSide: 2400, quality: 0.85 });
    } catch (error) {
      if (error instanceof ImageProcessingError) throw new CoverError("No pudimos leer esa imagen. Prueba con una foto JPG o PNG.");
      throw new CoverError("No pudimos preparar la imagen. Prueba con otra.");
    }
  }
  if (ready.size > MAX_UPLOAD_BYTES) throw new CoverError("La imagen supera los 5 MB. Sube una más liviana.");
  return ready;
}
