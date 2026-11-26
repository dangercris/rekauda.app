/** Retention of raw inbound mail. The daily scheduled() purge enforces it from the key date; an R2 lifecycle rule on the bucket (manual owner step) is a recommended second layer, measured from the upload time. */
export const MAIL_RETENTION_DAYS = 30;

const TENANT_ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY_KEY = /^t\/[A-Za-z0-9-]{1,64}\/(\d{4}-\d{2}-\d{2})\/[A-Za-z0-9-]+\.eml$/;

/** Port: keep the raw message of one tenant. Returns the key it was stored under. */
export interface RawMailArchive {
  put(tenantId: string, raw: Uint8Array): Promise<string>;
}

/**
 * R2 adapter over the separate MAIL_ARCHIVE bucket. Keys are `t/<tenantId>/<YYYY-MM-DD>/<uuid>.eml` (UTC day), so the
 * tenant prefix is always the first segment. The clock and the id source are injected.
 */
export class R2MailArchive implements RawMailArchive {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly now: () => Date,
    private readonly uuid: () => string,
  ) {}

  async put(tenantId: string, raw: Uint8Array): Promise<string> {
    if (!TENANT_ID.test(tenantId)) throw new Error("invalid tenant id");
    const key = `t/${tenantId}/${this.now().toISOString().slice(0, 10)}/${this.uuid()}.eml`;
    await this.bucket.put(key, raw);
    return key;
  }

  /** Deletes every archived message whose UTC day is older than the retention window. Returns how many. Keys of another shape are left alone. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - MAIL_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    let deleted = 0;
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: "t/", ...(cursor ? { cursor } : {}) });
      const expired = page.objects.map((o) => o.key).filter((k) => (DAY_KEY.exec(k)?.[1] ?? "9999") < cutoff);
      if (expired.length > 0) await this.bucket.delete(expired);
      deleted += expired.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return deleted;
  }
}
