/// <reference types="node" />
/**
 * DKIM verification and the Deuna parser are security-critical and were not changed by the Cloud work. These hashes
 * pin the files as they were on feat/cloud-08-magic-links (`git diff feat/cloud-08-magic-links -- dkim.ts deuna.ts`
 * was empty). A deliberate change to either file must update the hash in the same reviewed commit.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FROZEN: Record<string, string> = {
  "dkim.ts": "415f7b6c772deaeba6516f5a042cf960605ee19defe5d91ff9c3e46beeacdec8",
  "deuna.ts": "919a01bf48867d3612a049afcd4eab5102dc8f07edc3023e83aaa44f81c77a33",
};

describe("security-critical email files", () => {
  it.each(Object.entries(FROZEN))("%s is byte-identical to the reviewed version", (file, hash) => {
    const bytes = readFileSync(new URL(file, import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  });
});
