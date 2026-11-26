import { COVER_PREFIX, MAX_BODY_BYTES, MAX_FILE_BYTES } from "./constants";
import type { RequestContext } from "./context";
import { BASE_HEADERS, HttpError, fail, readMultipart } from "./http";
import { sha256Hex } from "./ids";
import type { CollectionRow } from "./rows";
import { coverKey as relativeCoverKey } from "./storage/keys";
import { sniffImage } from "./validation";

const COVER_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{16})\.(jpg|png|webp)$/;

const TYPE_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Content-addressed tenant-relative key: `covers/<collectionId>/<first 16 hex of sha256>.<ext>`. TenantStorage adds the tenant prefix. */
export function coverKey(collectionId: string, sha256: string, ext: string): string {
  return relativeCoverKey(collectionId, sha256.slice(0, 16), ext);
}

/** `/api/covers/<path>` for a stored full key (`<r2Prefix>covers/<path>`), or null when the key is not one of this tenant's covers. */
export function coverUrl(key: string | null, r2Prefix: string): string | null {
  const root = `${r2Prefix}${COVER_PREFIX}`;
  return key?.startsWith(root) ? `/api/covers/${key.slice(root.length)}` : null;
}

/**
 * Guard for the public route: only `<uuid>/<16 hex>.<jpg|png|webp>` maps to an R2 key, and always under `covers/`.
 * Anything else (receipts, traversal, odd extensions) returns null.
 */
export function coverKeyFromPath(path: string): { key: string; contentType: string } | null {
  const m = COVER_PATH.exec(path);
  const ext = m?.[3];
  if (!m || !ext) return null;
  return { key: `${COVER_PREFIX}${path}`, contentType: TYPE_BY_EXT[ext] ?? "application/octet-stream" };
}

/** GET /api/covers/<id>/<hash>.<ext>: only keys currently stored as one of THIS tenant's collection covers are served. */
export async function serveCover({ db, storage }: RequestContext, path: string): Promise<Response> {
  const parsed = coverKeyFromPath(path);
  if (!parsed) return fail(404, "not_found", "Imagen no encontrada.");
  const fullKey = storage.keyFor(parsed.key);
  const known = await db.prepare("SELECT 1 FROM collections WHERE tenant_id = ?1 AND cover_key = ?2").bind(fullKey).first();
  if (!known) return fail(404, "not_found", "Imagen no encontrada.");
  const object = await storage.get(fullKey);
  if (!object) return fail(404, "not_found", "Imagen no encontrada.");
  return new Response(object.body, {
    headers: {
      ...BASE_HEADERS,
      "X-Robots-Tag": "noindex",
      "Content-Type": parsed.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

async function findCollectionRow({ db }: RequestContext, id: string): Promise<CollectionRow> {
  const row = await db.prepare("SELECT * FROM collections WHERE tenant_id = ?1 AND id = ?2").bind(id).first<CollectionRow>();
  if (!row) throw new HttpError(404, "collection_not_found", "No encontramos esta recaudación.");
  return row;
}

/** POST /api/admin/collections/:id/cover (the caller builds the response from the updated collection). */
export async function setCover(request: Request, rc: RequestContext, id: string): Promise<void> {
  const existing = await findCollectionRow(rc, id);
  const form = await readMultipart(request, MAX_BODY_BYTES, "La imagen supera los 5 MB. Sube una más liviana.");
  const file = form.get("cover");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "cover_required", "Adjunta la imagen de portada.");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "too_large", "La imagen supera los 5 MB. Sube una más liviana.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(415, "unsupported_file", "La portada debe ser una imagen JPG, PNG o WEBP.");

  const key = await rc.storage.put(coverKey(id, await sha256Hex(bytes), kind.ext), bytes, {
    httpMetadata: { contentType: kind.type },
    customMetadata: { collectionId: id },
  });
  try {
    await rc.db
      .prepare("UPDATE collections SET cover_key = ?2, updated_at = ?3 WHERE tenant_id = ?1 AND id = ?4")
      .bind(key, new Date().toISOString(), id)
      .run();
  } catch (e) {
    if (key !== existing.cover_key) await rc.storage.delete(key);
    throw e;
  }
  if (existing.cover_key && existing.cover_key !== key) await rc.storage.delete(existing.cover_key);

  console.log(JSON.stringify({ message: "cover set", id, bytes: bytes.byteLength }));
}

/** DELETE /api/admin/collections/:id/cover */
export async function removeCover(rc: RequestContext, id: string): Promise<void> {
  const existing = await findCollectionRow(rc, id);
  await rc.db.prepare("UPDATE collections SET cover_key = NULL, updated_at = ?2 WHERE tenant_id = ?1 AND id = ?3").bind(new Date().toISOString(), id).run();
  if (existing.cover_key) await rc.storage.delete(existing.cover_key);

  console.log(JSON.stringify({ message: "cover removed", id }));
}
