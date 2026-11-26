/**
 * Test-only DKIM signer. It canonicalizes on its own (independent of dkim.ts) so the verifier tests are not circular.
 */
const CRLF = "\r\n";

export interface TestKey {
  privateKey: CryptoKey;
  /** Base64 SPKI, as published in the p= tag. */
  publicBase64: string;
}

export async function generateKey(): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const exported = (await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer;
  const spki = new Uint8Array(exported);
  return { privateKey: pair.privateKey, publicBase64: btoa(String.fromCharCode(...spki)) };
}

const b64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));
const bin = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s));

function relaxedHeader(name: string, value: string): string {
  return `${name.toLowerCase()}:${value.replace(/\r\n(?=[ \t])/g, "").replace(/[ \t]+/g, " ").replace(/^[ \t]+|[ \t]+$/g, "")}`;
}

function relaxedBody(body: string): string {
  const lines = body.split(CRLF).map((l) => l.replace(/[ \t]+$/, "").replace(/[ \t]+/g, " "));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines.join(CRLF) + CRLF : "";
}

function simpleBody(body: string): string {
  const lines = body.split(CRLF);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines.join(CRLF) + CRLF : CRLF;
}

export interface SignOptions {
  domain?: string;
  selector?: string;
  canon?: "relaxed/relaxed" | "simple/simple" | "relaxed/simple" | "simple/relaxed";
  signedHeaders?: string[];
  /** Extra raw tags appended before b= (e.g. "l=10"). */
  extraTags?: string;
  /** Fold the DKIM-Signature over several lines like Amazon SES does ("tag;\r\n\ttag", h= split too). */
  fold?: boolean;
}

/** Headers are [name, value] pairs, written in order. Returns the full raw message with a DKIM-Signature on top. */
export async function signMessage(key: TestKey, headers: Array<[string, string]>, body: string, options: SignOptions = {}): Promise<string> {
  const { domain = "deunaapp.com", selector = "s1", canon = "relaxed/relaxed", extraTags = "" } = options;
  const [hc, bc] = canon.split("/") as ["simple" | "relaxed", "simple" | "relaxed"];
  const signed = options.signedHeaders ?? headers.map(([n]) => n.toLowerCase());

  const bodyHash = b64(await crypto.subtle.digest("SHA-256", bin(bc === "relaxed" ? relaxedBody(body) : simpleBody(body))));
  const hList = options.fold ? signed.join(":").replace(/:(?=[^:]*$)/, ":\r\n\t") : signed.join(":");
  const flat = `v=1; a=rsa-sha256; c=${canon}; d=${domain}; s=${selector}; h=${hList}; bh=${bodyHash};${extraTags ? ` ${extraTags};` : ""} b=`;
  const tags = options.fold ? flat.replace(/; /g, ";\r\n\t") : flat;

  const pool = headers.map(([n, v]) => ({ n, v }));
  let data = "";
  for (const name of signed) {
    const at = pool.map((h) => h.n.toLowerCase()).lastIndexOf(name);
    if (at === -1) continue;
    const [h] = pool.splice(at, 1);
    if (!h) continue;
    data += (hc === "relaxed" ? relaxedHeader(h.n, h.v) : `${h.n}: ${h.v}`) + CRLF;
  }
  data += hc === "relaxed" ? relaxedHeader("DKIM-Signature", tags) : `DKIM-Signature: ${tags}`;

  const signature = b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, bin(data)));
  const all = [`DKIM-Signature: ${tags}${signature}`, ...headers.map(([n, v]) => `${n}: ${v}`)];
  return all.join(CRLF) + CRLF + CRLF + body;
}

/** DoH-like TXT resolver that serves one key for every name. */
export function txtFor(key: TestKey, extra = ""): (name: string) => Promise<string[]> {
  return async () => [`v=DKIM1; k=rsa; ${extra}p=${key.publicBase64}`];
}
