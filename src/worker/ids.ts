/** Identifiers and hashing helpers (all based on Web Crypto). */

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Tracking code `XXX-XXX` over an alphabet without look-alike characters; rejection sampling avoids modulo bias. */
export function randomCode(): string {
  const out: string[] = [];
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && out.length < 6) out.push(CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length));
    }
  }
  return `${out.slice(0, 3).join("")}-${out.slice(3).join("")}`;
}

export async function uniqueCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const taken = await env.DB.prepare("SELECT 1 FROM payments WHERE code = ?").bind(code).first();
    if (!taken) return code;
  }
  throw new Error("could not allocate a unique code");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
