/** In-memory R2 bucket double covering put/get/head/delete, recording every key it is asked to read. */
export class FakeBucket {
  readonly objects = new Map<string, string>();
  /** Keys passed to get/head, so tests can prove a foreign key was never read. */
  readonly reads: string[] = [];

  async put(key: string, value: string): Promise<{ key: string }> {
    this.objects.set(key, value);
    return { key };
  }

  async get(key: string): Promise<{ key: string; text(): Promise<string> } | null> {
    this.reads.push(key);
    const value = this.objects.get(key);
    return value === undefined ? null : { key, text: async () => value };
  }

  async head(key: string): Promise<{ key: string } | null> {
    this.reads.push(key);
    return this.objects.has(key) ? { key } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** The Worker types its binding as R2Bucket; the double only covers the used surface. */
export function asR2(bucket: FakeBucket): R2Bucket {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return bucket as unknown as R2Bucket;
}
