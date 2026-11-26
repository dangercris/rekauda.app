/**
 * Client-side image preparation for uploads (receipts and covers).
 *
 * Photos straight from a phone camera are often 3-8 MB or HEIC. `prepareReceipt` keeps small
 * JPEG/PNG/WEBP files and PDFs untouched and re-encodes everything else to JPEG (max 2000 px side,
 * quality 0.86) so it fits the 5 MB limit and the server's accepted types.
 */

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const COMPRESS_ABOVE_BYTES = 1.2 * 1024 * 1024;

export interface CompressOptions {
  /** Longest side in px (default 2000). */
  maxSide?: number | undefined;
  /** JPEG quality 0..1 (default 0.86). */
  quality?: number | undefined;
}

export class ImageProcessingError extends Error {
  override readonly name = "ImageProcessingError";
}

const PASS_THROUGH = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

/** PDF by MIME type, or by `.pdf` extension (some browsers/OSes report an empty or generic type). */
export function isPdf(file: Blob): boolean {
  if (file.type === "application/pdf") return true;
  const name = (file as Partial<File>).name;
  return typeof name === "string" && /\.pdf$/i.test(name);
}

/** Cheap content sniff: PDFs start with `%PDF-`. */
export async function hasPdfSignature(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    return head.length === 5 && String.fromCharCode(...head) === "%PDF-";
  } catch {
    return false;
  }
}

/** True when the file should be re-encoded before upload. */
export function needsCompression(file: File): boolean {
  if (isPdf(file)) return false;
  return file.size > COMPRESS_ABOVE_BYTES || !PASS_THROUGH.has(file.type);
}

/**
 * Returns a file ready to upload as a payment receipt. Throws ImageProcessingError (Spanish message)
 * when the browser cannot decode the image (e.g. HEIC on a non-Apple browser).
 */
export async function prepareReceipt(file: File, options?: CompressOptions): Promise<File> {
  if (!needsCompression(file)) return file;
  if (await hasPdfSignature(file)) return file;
  return compressImage(file, options);
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the <img> decoder (older Safari).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageProcessingError("No pudimos leer la imagen. Toma una captura de pantalla del comprobante y súbela.");
  }
}

/** Re-encodes an image to JPEG, scaling it down so the longest side is at most `maxSide`. */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const maxSide = options.maxSide ?? 2000;
  const quality = options.quality ?? 0.86;
  const image = await decode(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageProcessingError("Tu navegador no pudo procesar la imagen.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new ImageProcessingError("Tu navegador no pudo procesar la imagen.");
    const base = file.name.replace(/\.[^.]+$/, "") || "comprobante";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    image.close();
  }
}
