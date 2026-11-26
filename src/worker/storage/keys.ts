/** Tenant-relative R2 key builders. TenantStorage adds the tenant prefix; rows store the full key it returns. */

const KINDS: ReadonlySet<string> = new Set(["receipts", "covers", "og", "assets"]);
const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function tenantPrefix(tenantId: string): string {
  return `t/${tenantId}/`;
}

export const receiptKey = (paymentId: string, ext: string): string => `receipts/${paymentId}.${ext}`;
export const coverKey = (collectionId: string, hash16: string, ext: string): string => `covers/${collectionId}/${hash16}.${ext}`;
export const ogKey = (slug: string, version: string): string => `og/${slug}/${version}.jpg`;
export const assetKey = (name: string): string => `assets/${name}`;

/** `<kind>/<segment>...` with a known kind and plain segments only: no empty or dots-only segments and only [A-Za-z0-9._-] characters (so no backslash, percent-encoding or non-ASCII). */
export function isRelativeKey(key: string): boolean {
  const [kind, ...rest] = key.split("/");
  return KINDS.has(kind ?? "") && rest.length > 0 && rest.every((s) => SEGMENT.test(s) && !/^\.+$/.test(s));
}
