import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKey, signMessage, txtFor, type TestKey } from "../test/sign";
import { resolveTxtOverHttps, verifyDkim } from "./dkim";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const HEADERS: Array<[string, string]> = [
  ["From", "Deuna <notificaciones@deunaapp.com>"],
  ["To", "secret@example.test"],
  ["Subject", "Recibiste $14,00 en tu cuenta Deuna"],
  ["Date", "Thu, 26 Nov 2026 14:02:11 +0000"],
];
const BODY = "Hola,\r\nRecibiste $14,00   de Alguien con Deuna!\r\n\r\n";

let key: TestKey;
let otherKey: TestKey;
beforeAll(async () => {
  key = await generateKey();
  otherKey = await generateKey();
});

const verify = (raw: string, resolveTxt = txtFor(key), now?: number) =>
  verifyDkim(enc(raw), { domain: "deunaapp.com", resolveTxt, retryDelayMs: 0, ...(now === undefined ? {} : { now }) });

describe("verifyDkim", () => {
  it.each(["relaxed/relaxed", "simple/simple", "relaxed/simple", "simple/relaxed"] as const)("accepts a valid %s signature", async (canon) => {
    const raw = await signMessage(key, HEADERS, BODY, { canon });
    expect(await verify(raw)).toEqual({ ok: true, domain: "deunaapp.com", selector: "s1" });
  });

  it("requires d= to be exactly the domain (subdomains are rejected)", async () => {
    const raw = await signMessage(key, HEADERS, BODY, { domain: "mail.deunaapp.com" });
    expect(await verify(raw)).toMatchObject({ ok: false, reason: "domain_mismatch" });
  });

  it("retries a transient DNS failure up to twice before giving up", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    let calls = 0;
    const flaky = async (name: string) => {
      calls += 1;
      if (calls < 3) throw new Error("doh timeout");
      return txtFor(key)(name);
    };
    expect((await verifyDkim(enc(raw), { domain: "deunaapp.com", resolveTxt: flaky, retryDelayMs: 0 })).ok).toBe(true);
    expect(calls).toBe(3);

    let always = 0;
    const down = async () => {
      always += 1;
      throw new Error("down");
    };
    expect(await verifyDkim(enc(raw), { domain: "deunaapp.com", resolveTxt: down, retryDelayMs: 0 })).toMatchObject({ ok: false, reason: "key_unavailable" });
    expect(always).toBe(3);
  });

  it("keeps non-breaking spaces and high bytes intact when canonicalizing", async () => {
    const headers: Array<[string, string]> = [...HEADERS, ["X-Note", "\u00a0caf\u00e9\u00a0"]];
    const raw = await signMessage(key, headers, BODY);
    expect((await verify(raw)).ok).toBe(true);
    // Replacing the NBSP by a plain space changes the signed bytes and must fail.
    expect((await verify(raw.replace("X-Note: \u00a0caf", "X-Note:  caf"))).ok).toBe(false);
  });

  it.each(["relaxed/simple", "relaxed/relaxed", "simple/simple"] as const)(
    "verifies a DKIM-Signature folded over several lines like Amazon SES sends it (%s)",
    async (canon) => {
      const raw = await signMessage(key, HEADERS, BODY, { canon, fold: true });
      expect(raw).toMatch(/DKIM-Signature: v=1;\r\n\ta=rsa-sha256;/);
      expect((await verify(raw)).ok).toBe(true);
    },
  );

  it("tolerates folded headers and whitespace changes under relaxed canonicalization", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    const rewrapped = raw.replace("Subject: Recibiste", "Subject:   Recibiste\r\n  ").replace("Hola,", "Hola,   ");
    expect((await verify(rewrapped)).ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    expect(await verify(raw.replace("de Alguien", "de Otra"))).toMatchObject({ ok: false, reason: "body_hash_mismatch" });
  });

  it("rejects a tampered signed header", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    expect(await verify(raw.replace("secret@example.test", "other@example.test"))).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a forged From address", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    expect(await verify(raw.replace("notificaciones@deunaapp.com", "estafa@deunaapp.com"))).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a signature made with another key", async () => {
    const raw = await signMessage(otherKey, HEADERS, BODY);
    expect(await verify(raw)).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects the wrong signing domain", async () => {
    const raw = await signMessage(key, HEADERS, BODY, { domain: "evil.example" });
    expect(await verify(raw)).toMatchObject({ ok: false, reason: "domain_mismatch" });
    const lookalike = await signMessage(key, HEADERS, BODY, { domain: "notdeunaapp.com" });
    expect(await verify(lookalike)).toMatchObject({ ok: false, reason: "domain_mismatch" });
  });

  it("rejects a message without a signature", async () => {
    const raw = HEADERS.map(([n, v]) => `${n}: ${v}`).join("\r\n") + "\r\n\r\n" + BODY;
    expect(await verify(raw)).toMatchObject({ ok: false, reason: "no_signature" });
  });

  it("rejects signatures that use the l= body length limit", async () => {
    const raw = await signMessage(key, HEADERS, BODY, { extraTags: "l=10" });
    expect(await verify(raw)).toMatchObject({ ok: false, reason: "body_length_limit" });
  });

  it("rejects a signature that does not cover From", async () => {
    const raw = await signMessage(key, HEADERS, BODY, { signedHeaders: ["to", "subject"] });
    expect(await verify(raw)).toMatchObject({ ok: false, reason: "from_not_signed" });
  });

  it("rejects a second From header (display spoofing)", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    const spoofed = raw.replace("From: Deuna", "From: Estafa <estafa@example.test>\r\nFrom: Deuna");
    expect(await verify(spoofed)).toMatchObject({ ok: false, reason: "multiple_from" });
  });

  it("rejects an expired signature", async () => {
    const raw = await signMessage(key, HEADERS, BODY, { extraTags: "x=1000" });
    expect(await verify(raw, txtFor(key), 2000)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("passes when one of several signatures is valid", async () => {
    const good = await signMessage(key, HEADERS, BODY);
    const bad = (await signMessage(otherKey, HEADERS, BODY, { selector: "s2" })).split("\r\n\r\n")[0]?.split("\r\n")[0] ?? "";
    const resolveTxt = async (name: string) => (name.startsWith("s2.") ? txtFor(otherKey)(name) : txtFor(key)(name));
    // A broken signature header on top of a good one.
    const multi = `${bad.replace(/b=.*$/, "b=AAAA")}\r\n${good}`;
    expect((await verify(multi, resolveTxt)).ok).toBe(true);
  });

  it("fails when every signature is invalid", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    const result = await verify(raw.replace("$14,00", "$15,00"));
    expect(result.ok).toBe(false);
  });

  it("fails when the key cannot be fetched", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    expect(await verify(raw, async () => [])).toMatchObject({ ok: false, reason: "key_unavailable" });
    expect(
      await verify(raw, async () => {
        throw new Error("network");
      }),
    ).toMatchObject({ ok: false, reason: "key_unavailable" });
  });

  it("fails on a revoked key (empty p=)", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    expect((await verify(raw, async () => ["v=DKIM1; k=rsa; p="])).ok).toBe(false);
  });

  it("accepts LF-only line endings (normalized to CRLF)", async () => {
    const raw = await signMessage(key, HEADERS, BODY);
    expect((await verify(raw.replace(/\r\n/g, "\n"))).ok).toBe(true);
  });
});

describe("resolveTxtOverHttps", () => {
  it("queries Cloudflare DoH and joins chunked TXT answers", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ Answer: [{ type: 16, data: '"v=DKIM1; k=rsa; p=AAAA" "BBBB"' }, { type: 5, data: "cname.example." }] }),
    );
    const records = await resolveTxtOverHttps("s1._domainkey.deunaapp.com", fetcher as unknown as typeof fetch);
    expect(records).toEqual(["v=DKIM1; k=rsa; p=AAAABBBB"]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cloudflare-dns.com/dns-query?name=s1._domainkey.deunaapp.com&type=TXT");
    expect(new Headers(init.headers).get("accept")).toBe("application/dns-json");
  });

  it("throws on a failed lookup and returns [] without answers", async () => {
    await expect(resolveTxtOverHttps("x", (async () => new Response("no", { status: 502 })) as unknown as typeof fetch)).rejects.toThrow();
    expect(await resolveTxtOverHttps("x", (async () => Response.json({ Status: 3 })) as unknown as typeof fetch)).toEqual([]);
  });
});
