/**
 * Minimal MIME builder (RFC 5322 / 2045 / 2047). Every header value is checked for CR, LF and NUL first, because a
 * line break inside a value is how extra headers (Bcc) get injected. Bodies are base64 UTF-8, so no body line can
 * ever be mistaken for a header or a boundary.
 */

export class MimeError extends Error {}

export interface MimeMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  date: Date;
  /** Without angle brackets, for example `uuid@rekauda.app`. */
  messageId: string;
  boundary?: string;
}

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+|localhost)$/;
const MAX_WORD_BYTES = 45; // 45 bytes encode to 60 characters, +12 of framing stays under the 75 of RFC 2047.

export function assertHeaderValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new MimeError("header value contains a control character");
  return value;
}

/** A bare addr-spec (no display name, no list): what the platform ever sends to or from. */
export function assertAddress(address: string): string {
  assertHeaderValue(address);
  if (address.length > 254 || !ADDRESS.test(address)) throw new MimeError("malformed address");
  return address;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const wrap76 = (b64: string): string => (b64.match(/.{1,76}/g) ?? []).join("\r\n");

/** Printable ASCII passes as is. Anything else becomes RFC 2047 UTF-8 base64 words that never split a character. */
export function encodeSubject(subject: string): string {
  assertHeaderValue(subject);
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    if (chunk.length) words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
    chunk = [];
  };
  for (const char of subject) {
    const bytes = encoder.encode(char);
    if (chunk.length + bytes.length > MAX_WORD_BYTES) flush();
    chunk.push(...bytes);
  }
  flush();
  return words.join("\r\n ");
}

const part = (type: string, content: string): string =>
  `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(base64(new TextEncoder().encode(content.replace(/\r?\n/g, "\r\n"))))}\r\n`;

export function buildMime(m: MimeMessage): string {
  const from = assertAddress(m.from);
  const headers = [
    `From: ${from}`,
    `To: ${assertAddress(m.to)}`,
    `Subject: ${encodeSubject(m.subject)}`,
    `Date: ${m.date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${assertHeaderValue(m.messageId)}>`,
    "MIME-Version: 1.0",
  ];
  if (m.html === undefined) return `${headers.join("\r\n")}\r\n${part("text/plain", m.text)}`;
  const boundary = assertHeaderValue(m.boundary ?? `rk-${crypto.randomUUID()}`);
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  return `${headers.join("\r\n")}\r\n\r\n--${boundary}\r\n${part("text/plain", m.text)}--${boundary}\r\n${part("text/html", m.html)}--${boundary}--\r\n`;
}
