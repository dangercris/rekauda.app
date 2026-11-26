import { describe, expect, it } from "vitest";
import { MimeError, assertAddress, assertHeaderValue, buildMime, encodeSubject } from "./mime";

const base = { from: "no-reply@rekauda.test", to: "madre@example.test", subject: "Hola", text: "Hola, mundo", date: new Date("2026-11-26T15:00:00Z"), messageId: "abc@rekauda.test" };

/** Decodes the RFC 2047 encoded words of a header back to text. */
function decodeWords(header: string): string {
  return header
    .split(/\r\n /)
    .map((w) => /^=\?UTF-8\?B\?(.+)\?=$/.exec(w)?.[1] ?? "")
    .map((b64) => Buffer.from(b64, "base64").toString("utf8"))
    .join("");
}

describe("header safety", () => {
  it.each(["a\r\nBcc: x@example.test", "a\nb", "a\rb", "a\0b"])("rejects control characters in a header value: %j", (value) => {
    expect(() => assertHeaderValue(value)).toThrow(MimeError);
  });

  it("rejects an injection in the subject, the recipient or the sender", () => {
    expect(() => buildMime({ ...base, subject: "Hola\r\nBcc: spy@example.test" })).toThrow(MimeError);
    expect(() => buildMime({ ...base, to: "a@example.test\r\nBcc: spy@example.test" })).toThrow(MimeError);
    expect(() => buildMime({ ...base, from: "x@example.test\nX: y" })).toThrow(MimeError);
  });

  it.each(["", "plain", "a@b", "a b@example.test", "<a@example.test>", "a@example.test,b@example.test", "a@@example.test"])("rejects the malformed address %j", (address) => {
    expect(() => assertAddress(address)).toThrow(MimeError);
  });

  it("accepts an ordinary address", () => {
    expect(assertAddress("madre.demo+1@example.test")).toBe("madre.demo+1@example.test");
  });
});

describe("subject encoding (RFC 2047)", () => {
  it("leaves a printable ASCII subject as is", () => {
    expect(encodeSubject("Tu enlace de acceso")).toBe("Tu enlace de acceso");
  });

  it("encodes accents as UTF-8 base64 words that decode back", () => {
    const encoded = encodeSubject("Tesorería: confirmación de ingreso");
    expect(encoded.startsWith("=?UTF-8?B?")).toBe(true);
    expect(decodeWords(encoded)).toBe("Tesorería: confirmación de ingreso");
  });

  it("splits a long subject into words of at most 75 characters without cutting a character", () => {
    const subject = "ñandú ".repeat(30);
    const encoded = encodeSubject(subject);
    for (const word of encoded.split("\r\n ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeWords(encoded)).toBe(subject);
  });
});

describe("message layout", () => {
  it("uses CRLF only, the required headers and a base64 text/plain UTF-8 body", () => {
    const raw = buildMime({ ...base, subject: "Tesorería", text: "Línea uno\nLínea dos" });
    expect(raw).not.toMatch(/(?<!\r)\n/);
    const [head = "", body = ""] = raw.split("\r\n\r\n");
    expect(head).toContain("From: no-reply@rekauda.test");
    expect(head).toContain("To: madre@example.test");
    expect(head).toContain("MIME-Version: 1.0");
    expect(head).toContain("Message-ID: <abc@rekauda.test>");
    expect(head).toContain("Date: Thu, 26 Nov 2026 15:00:00 +0000");
    expect(head).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(head).toContain("Content-Transfer-Encoding: base64");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Línea uno\r\nLínea dos");
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("wraps text and html as multipart/alternative", () => {
    const raw = buildMime({ ...base, html: "<p>Hola</p>", boundary: "bnd" });
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="bnd"');
    expect(raw.indexOf("text/plain")).toBeLessThan(raw.indexOf("text/html"));
    expect(raw.endsWith("--bnd--\r\n")).toBe(true);
  });
});
