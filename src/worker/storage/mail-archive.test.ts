import { describe, expect, it } from "vitest";
import { FakeBucket, asR2 } from "../test/r2-fake";
import { MAIL_RETENTION_DAYS, R2MailArchive } from "./mail-archive";

const NOW = new Date("2026-11-26T15:00:00.000Z");
const TENANT = "a0000000-0000-4000-8000-00000000000a";
const OTHER = "b0000000-0000-4000-8000-00000000000b";
const bytes = new TextEncoder().encode("From: x\r\n\r\nbody");

function archive(bucket: FakeBucket, now: () => Date = () => NOW) {
  let n = 0;
  return new R2MailArchive(asR2(bucket), now, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
}

describe("R2MailArchive", () => {
  it("stores the raw message under t/<tenant>/<UTC day>/<uuid>.eml", async () => {
    const bucket = new FakeBucket();
    const key = await archive(bucket).put(TENANT, bytes);
    expect(key).toBe(`t/${TENANT}/2026-11-26/00000000-0000-4000-8000-000000000001.eml`);
    expect([...bucket.objects.keys()]).toEqual([key]);
  });

  it("uses the injected clock for the day, in UTC", async () => {
    const bucket = new FakeBucket();
    const key = await archive(bucket, () => new Date("2026-12-31T23:59:59.000Z")).put(TENANT, bytes);
    expect(key).toContain(`t/${TENANT}/2026-12-31/`);
  });

  it.each(["", "../x", "a/b", "t/other", "a b", "x".repeat(65)])("refuses the tenant id %j without writing", async (id) => {
    const bucket = new FakeBucket();
    await expect(archive(bucket).put(id, bytes)).rejects.toThrow("invalid tenant id");
    expect(bucket.objects.size).toBe(0);
  });

  it("purges only keys older than the retention window, for every tenant, using the injected clock", async () => {
    const bucket = new FakeBucket();
    const day = (offset: number) => new Date(NOW.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    const keep = [`t/${TENANT}/${day(MAIL_RETENTION_DAYS)}/k1.eml`, `t/${OTHER}/${day(1)}/k2.eml`];
    const drop = [`t/${TENANT}/${day(MAIL_RETENTION_DAYS + 1)}/d1.eml`, `t/${OTHER}/${day(400)}/d2.eml`];
    for (const key of [...keep, ...drop]) bucket.objects.set(key, "x");
    bucket.objects.set("t/not-a-mail-key", "x");

    expect(await archive(bucket).purgeExpired()).toBe(2);
    expect([...bucket.objects.keys()].sort()).toEqual([...keep, "t/not-a-mail-key"].sort());
  });
});
