/**
 * Focused DKIM verifier (RFC 6376) for the Deuna pipeline.
 *
 * Scope on purpose: rsa-sha256 only, no `l=` body limit, simple and relaxed canonicalization, public key
 * through DNS-over-HTTPS. It answers one question: "was this message really signed by <domain>?".
 * It does not evaluate DMARC or SPF.
 */

export type DkimFailure =
  | "no_signature"
  | "malformed_message"
  | "multiple_from"
  | "malformed_signature"
  | "unsupported_version"
  | "unsupported_algorithm"
  | "unsupported_canonicalization"
  | "body_length_limit"
  | "from_not_signed"
  | "domain_mismatch"
  | "expired"
  | "key_unavailable"
  | "key_invalid"
  | "body_hash_mismatch"
  | "signature_mismatch";

/** Outcome of one DKIM-Signature header, for diagnostics (d= and s= are public DNS names, not personal data). */
export interface SignatureAttempt {
  d: string | null;
  s: string | null;
  reason: DkimFailure;
}

export type DkimResult =
  | { ok: true; domain: string; selector: string }
  /** `reason` is the last failure; `signatures` lists what happened to every signature tried. */
  | { ok: false; reason: DkimFailure; signatures?: SignatureAttempt[] };

/** Resolves the TXT records published at `<selector>._domainkey.<domain>` (each record already joined). */
export type TxtResolver = (name: string) => Promise<string[]>;

export interface DkimOptions {
  /** Required signing domain, exact match (subdomains are not accepted). */
  domain: string;
  /** Defaults to DNS-over-HTTPS (Cloudflare). Injected in tests. */
  resolveTxt?: TxtResolver;
  /** Epoch seconds, for `x=` expiry. Defaults to now. */
  now?: number;
  /** Base delay between DNS retries in ms (attempt n waits n times this). Default 250. */
  retryDelayMs?: number;
}

const CRLF = "\r\n";

// RFC 6376 whitespace is only SP and HTAB. JS trim() and \s also strip U+00A0 (byte 0xA0 in these binary strings).
const trimWsp = (value: string): string => value.replace(/^[ \t]+|[ \t]+$/g, "");
const stripWspAndBreaks = (value: string): string => value.replace(/[ \t\r\n]+/g, "");
/** Lowercase ASCII only: header names, tags and domains are ASCII, and bytes above 0x7F must stay untouched. */
const asciiLower = (value: string): string => value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const headerKey = (name: string): string => asciiLower(trimWsp(name));
/** Trims folding white space (SP, HTAB, CR, LF): DKIM-Signature tags are usually folded over several lines (e.g. Amazon SES). */
const trimFws = (value: string): string => value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
const MAX_SIGNATURES = 5;

// ---------------------------------------------------------------- binary strings

/** Bytes to a "binary string" (one char per byte) so hashing is byte-exact whatever the charset. */
export function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return out;
}

function binaryToBytes(binary: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return binaryToBytes(atob(value));
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

// ---------------------------------------------------------------- message parsing

interface Header {
  /** Name as written. */
  name: string;
  /** The whole header exactly as received, folded lines included, without the trailing CRLF. */
  raw: string;
}

interface ParsedMessage {
  headers: Header[];
  body: string;
}

/** Splits a message into headers and body. Bare LF is normalized to CRLF (SMTP always delivers CRLF). */
export function parseMessage(binary: string): ParsedMessage | null {
  const text = binary.replace(/\r?\n/g, CRLF);
  const split = text.indexOf(CRLF + CRLF);
  const headerBlock = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? "" : text.slice(split + 4);
  const headers: Header[] = [];
  for (const line of headerBlock.split(CRLF)) {
    if (line === "") continue;
    if (/^[ \t]/.test(line)) {
      const last = headers[headers.length - 1];
      if (!last) return null;
      last.raw += CRLF + line;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) return null;
    headers.push({ name: line.slice(0, colon), raw: line });
  }
  return { headers, body };
}

// ---------------------------------------------------------------- canonicalization

export function canonicalizeBody(body: string, mode: "simple" | "relaxed"): string {
  let lines = body.split(CRLF);
  if (mode === "relaxed") lines = lines.map((line) => line.replace(/[ \t]+$/, "").replace(/[ \t]+/g, " "));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return mode === "simple" ? CRLF : "";
  return lines.join(CRLF) + CRLF;
}

/** Canonical header, without the trailing CRLF. */
export function canonicalizeHeader(header: Header, mode: "simple" | "relaxed"): string {
  if (mode === "simple") return header.raw;
  const colon = header.raw.indexOf(":");
  const name = headerKey(header.raw.slice(0, colon));
  const value = header.raw
    .slice(colon + 1)
    .replace(/\r\n(?=[ \t])/g, "")
    .replace(/[ \t]+/g, " ");
  return `${name}:${trimWsp(value)}`;
}

// ---------------------------------------------------------------- signature tags

type Tags = Map<string, string>;

function parseTags(value: string): Tags | null {
  const tags: Tags = new Map();
  for (const part of value.split(";")) {
    if (trimFws(part) === "") continue;
    const eq = part.indexOf("=");
    if (eq < 1) return null;
    const name = trimFws(part.slice(0, eq));
    if (!name || tags.has(name)) return null;
    tags.set(name, trimFws(part.slice(eq + 1)));
  }
  return tags;
}

/** The same header with the value of `b=` emptied, as required to compute the signed data. */
function withEmptySignature(raw: string): string {
  return raw.replace(/([; \t\r\n:]b[ \t\r\n]*=)[^;]*/, "$1");
}

function sha256(binary: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", binaryToBytes(binary));
}

// ---------------------------------------------------------------- public key lookup

/** Default resolver: Cloudflare DNS-over-HTTPS JSON API. */
export async function resolveTxtOverHttps(name: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetcher(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`doh status ${response.status}`);
  const body: unknown = await response.json();
  // SERVFAIL and REFUSED are transient resolver problems, unlike NXDOMAIN (3) or an empty answer.
  if (typeof body === "object" && body !== null && "Status" in body && (body.Status === 2 || body.Status === 5)) throw new Error("doh resolver failure");
  if (typeof body !== "object" || body === null || !("Answer" in body) || !Array.isArray(body.Answer)) return [];
  const records: string[] = [];
  for (const answer of body.Answer as unknown[]) {
    if (typeof answer !== "object" || answer === null || !("type" in answer) || answer.type !== 16) continue;
    if (!("data" in answer) || typeof answer.data !== "string") continue;
    records.push(joinTxtChunks(answer.data));
  }
  return records;
}

/** DoH returns `"chunk1" "chunk2"` for long TXT records: concatenate the quoted chunks. */
function joinTxtChunks(data: string): string {
  const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? "").replace(/\\(.)/g, "$1"));
  return chunks.length > 0 ? chunks.join("") : data;
}

const DNS_RETRIES = 2;

/** A transient DoH failure must not lose a legitimate mail: retry up to twice with a short backoff. */
async function lookupWithRetry(name: string, resolveTxt: TxtResolver, delayMs: number): Promise<string[] | null> {
  for (let attempt = 0; attempt <= DNS_RETRIES; attempt++) {
    try {
      return await resolveTxt(name);
    } catch {
      if (attempt < DNS_RETRIES && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  return null;
}

async function loadPublicKey(selector: string, domain: string, resolveTxt: TxtResolver, delayMs: number): Promise<CryptoKey | DkimFailure> {
  const records = await lookupWithRetry(`${selector}._domainkey.${domain}`, resolveTxt, delayMs);
  if (records === null) return "key_unavailable";
  for (const record of records) {
    const tags = parseTags(record);
    if (!tags) continue;
    const version = tags.get("v");
    if (version !== undefined && version !== "DKIM1") continue;
    const keyType = tags.get("k") ?? "rsa";
    const p = (tags.get("p") ?? "").replace(/[ \t\r\n]+/g, "");
    if (keyType !== "rsa" || !p) continue;
    const der = base64ToBytes(p);
    if (!der) continue;
    try {
      return await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    } catch {
      return "key_invalid";
    }
  }
  return records.length === 0 ? "key_unavailable" : "key_invalid";
}

// ---------------------------------------------------------------- verification

async function verifySignature(message: ParsedMessage, header: Header, options: DkimOptions, resolveTxt: TxtResolver): Promise<DkimResult> {
  const value = header.raw.slice(header.raw.indexOf(":") + 1);
  const tags = parseTags(value);
  if (!tags) return { ok: false, reason: "malformed_signature" };

  if (tags.get("v") !== "1") return { ok: false, reason: "unsupported_version" };
  if (asciiLower(tags.get("a") ?? "") !== "rsa-sha256") return { ok: false, reason: "unsupported_algorithm" };
  if (tags.has("l")) return { ok: false, reason: "body_length_limit" };

  const d = asciiLower(tags.get("d") ?? "");
  const s = tags.get("s");
  const h = tags.get("h");
  const bh = stripWspAndBreaks(tags.get("bh") ?? "");
  const b = stripWspAndBreaks(tags.get("b") ?? "");
  if (!d || !s || !h || !bh || !b) return { ok: false, reason: "malformed_signature" };
  if (!/^[a-z0-9.-]+$/.test(d) || !/^[A-Za-z0-9._-]+$/.test(s)) return { ok: false, reason: "malformed_signature" };
  if (d !== asciiLower(options.domain)) return { ok: false, reason: "domain_mismatch" };

  const [headerCanon = "simple", bodyCanon = headerCanon] = asciiLower(tags.get("c") ?? "simple/simple").split("/");
  if ((headerCanon !== "simple" && headerCanon !== "relaxed") || (bodyCanon !== "simple" && bodyCanon !== "relaxed")) {
    return { ok: false, reason: "unsupported_canonicalization" };
  }

  const signedNames = h
    .split(":")
    .map((name) => asciiLower(trimFws(name)))
    .filter(Boolean);
  if (!signedNames.includes("from")) return { ok: false, reason: "from_not_signed" };

  const expires = tags.get("x");
  if (expires !== undefined) {
    const at = Number(expires);
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (!Number.isFinite(at) || at < now) return { ok: false, reason: "expired" };
  }

  // Body hash.
  const canonicalBody = canonicalizeBody(message.body, bodyCanon);
  const computed = bytesToBase64(new Uint8Array(await sha256(canonicalBody)));
  if (computed !== bh) return { ok: false, reason: "body_hash_mismatch" };

  // Header hash: the h= headers (bottom-up, one instance per mention), then this signature with b= emptied.
  const remaining = new Map<string, Header[]>();
  for (const candidate of message.headers) {
    const key = headerKey(candidate.name);
    remaining.set(key, [...(remaining.get(key) ?? []), candidate]);
  }
  let signedData = "";
  for (const name of signedNames) {
    const instance = remaining.get(name)?.pop();
    if (instance) signedData += canonicalizeHeader(instance, headerCanon) + CRLF;
  }
  signedData += canonicalizeHeader({ name: header.name, raw: withEmptySignature(header.raw) }, headerCanon);

  const signature = base64ToBytes(b);
  if (!signature) return { ok: false, reason: "malformed_signature" };

  const key = await loadPublicKey(s, d, resolveTxt, options.retryDelayMs ?? 250);
  if (typeof key === "string") return { ok: false, reason: key };

  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, binaryToBytes(signedData));
  return valid ? { ok: true, domain: d, selector: s } : { ok: false, reason: "signature_mismatch" };
}

/**
 * Verifies the DKIM-Signature headers of a raw message. Passes when at least one signature is valid,
 * made by exactly `options.domain`, and covers the From header.
 * A message with more than one From header is rejected: it could make the signed From differ from the displayed one.
 */
export async function verifyDkim(raw: Uint8Array, options: DkimOptions): Promise<DkimResult> {
  const message = parseMessage(bytesToBinary(raw));
  if (!message) return { ok: false, reason: "malformed_message" };
  if (message.headers.filter((h) => headerKey(h.name) === "from").length > 1) return { ok: false, reason: "multiple_from" };

  const signatures = message.headers.filter((h) => headerKey(h.name) === "dkim-signature").slice(0, MAX_SIGNATURES);
  if (signatures.length === 0) return { ok: false, reason: "no_signature" };

  const resolveTxt = options.resolveTxt ?? ((name: string) => resolveTxtOverHttps(name));
  const attempts: SignatureAttempt[] = [];
  for (const signature of signatures) {
    let result: DkimResult;
    try {
      result = await verifySignature(message, signature, options, resolveTxt);
    } catch {
      result = { ok: false, reason: "malformed_signature" };
    }
    if (result.ok) return result;
    const tags = parseTags(signature.raw.slice(signature.raw.indexOf(":") + 1));
    attempts.push({ d: tags?.get("d") ?? null, s: tags?.get("s") ?? null, reason: result.reason });
  }
  return { ok: false, reason: attempts.at(-1)?.reason ?? "no_signature", signatures: attempts };
}
