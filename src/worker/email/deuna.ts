/**
 * Parser for the "Recibiste $X en tu cuenta Deuna" notification.
 *
 * We do not have the raw HTML, so extraction is label based over plain text: the text is flattened to one
 * line, accents are folded for matching only, and each value is whatever sits between its label and the next
 * known label. That tolerates table layouts, extra whitespace and newlines. Other Deuna mails (OTP codes,
 * promos) have no transaction number and return null.
 */

export interface DeunaPayment {
  transactionNumber: string;
  amountCents: number;
  /** ISO 8601 UTC. The mail states Ecuador local time (UTC-5, no daylight saving). */
  receivedAt: string;
  originBank: string | null;
  /** Masked, as written in the mail. */
  originAccount: string | null;
  destinationAccount: string;
  payerName: string | null;
  motive: string | null;
}

const ECUADOR_UTC_OFFSET_HOURS = 5;

const MONTHS: Record<string, number> = {
  ene: 0,
  feb: 1,
  mar: 2,
  abr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  sep: 8,
  set: 8,
  oct: 9,
  nov: 10,
  dic: 11,
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
};

/** Strips HTML to text. Good enough for label extraction: block tags become spaces, entities are decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(?:br|p|div|tr|td|th|li|ul|ol|table|tbody|thead|h[1-6]|section|span)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole);
}

/** One line, single spaces, NFC, invisible characters removed. */
function flatten(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[​-‏⁠﻿­]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase without accents, same length as the input (precomposed letters only), so indexes line up. */
function fold(text: string): string {
  const from = "áàäâãéèëêíìïîóòöôõúùüûñç";
  const to = "aaaaaeeeeiiiiooooouuuunc";
  let out = "";
  for (const ch of text.toLowerCase()) {
    const at = from.indexOf(ch);
    out += at === -1 ? ch : to.charAt(at);
  }
  return out;
}

interface Hit {
  /** Start of the label text. */
  at: number;
  /** End of the label and its optional colon. */
  end: number;
}

function labelHits(folded: string, label: string, from: number, to: number): Hit[] {
  const re = new RegExp(`(?:^|[^a-z])(${label})\\s*:?`, "g");
  re.lastIndex = from;
  const hits: Hit[] = [];
  for (let match = re.exec(folded); match !== null; match = re.exec(folded)) {
    const at = match.index + match[0].indexOf(label);
    if (at >= to) break;
    hits.push({ at, end: match.index + match[0].length });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

const DATE_SLOT = /^\d{1,2}\s+[a-z]{3,}\.?\s+\d{4}\s*[-–—,]?\s*\d{1,2}\s*(?:h|:)\s*\d{2}$/;
const MONEY_SLOT = /^\$\s*\d[\d.,]*(?:\s*usd)?$/;

interface Fields {
  amount: string;
  motive: string;
  date: string;
  origin: string;
  destination: string;
  payer: string;
  transaction: string;
}

/**
 * Splits the details block by the known label sequence. Motivo is free text typed by the payer, so a motive may
 * contain label-like text. Everything after Motivo is therefore anchored from the END (last occurrence of each label,
 * each before the next), and the Fecha label must be followed by a bare date. Whatever the payer typed stays inside
 * the Motivo slot.
 */
function extractFields(flat: string): Fields | { missing: string } {
  const folded = fold(flat);
  const heading = folded.search(/detalles de tu pago/);
  if (heading === -1) return { missing: "details_heading" };
  const end = folded.length;

  const tx = labelHits(folded, "numero de transaccion", heading, end).at(-1);
  if (!tx) return { missing: "label_transaction_number" };
  const payer = labelHits(folded, "nombre del ordenante", heading, tx.at).at(-1);
  if (!payer) return { missing: "label_payer_name" };
  const destination = labelHits(folded, "cuenta de destino", heading, payer.at).at(-1);
  if (!destination) return { missing: "label_destination_account" };
  const origin = labelHits(folded, "cuenta de origen", heading, destination.at).at(-1);
  if (!origin) return { missing: "label_origin_account" };
  const fecha = labelHits(folded, "fecha", heading, origin.at)
    .reverse()
    .find((hit) => DATE_SLOT.test(folded.slice(hit.end, origin.at).trim()));
  if (!fecha) return { missing: "label_date_with_valid_date" };
  const monto = labelHits(folded, "monto", heading, fecha.at)[0];
  if (!monto) return { missing: "label_amount" };
  const motivo = labelHits(folded, "motivo", monto.end, fecha.at)[0];
  if (!motivo) return { missing: "label_motive" };

  const slice = (from: number, to: number): string => flat.slice(from, to).trim();
  return {
    amount: slice(monto.end, motivo.at),
    motive: slice(motivo.end, fecha.at),
    date: slice(fecha.end, origin.at),
    origin: slice(origin.end, destination.at),
    destination: slice(destination.end, payer.at),
    payer: slice(payer.end, tx.at),
    transaction: slice(tx.end, end),
  };
}

/** "$1.234,56" -> 123456, "$14,00" -> 1400, "14.5" -> 1450. Null when it is not a clean money amount. */
export function parseAmountCents(raw: string): number | null {
  const match = /\$?\s*(\d[\d.,]*)/.exec(raw);
  const digits = match?.[1];
  if (!digits) return null;
  const lastSeparator = Math.max(digits.lastIndexOf(","), digits.lastIndexOf("."));
  let whole = digits;
  let fraction = "";
  if (lastSeparator !== -1) {
    const tail = digits.slice(lastSeparator + 1);
    // A 1 or 2 digit tail is the decimal part; exactly 3 digits is a thousands group ("1.234").
    if (tail.length === 1 || tail.length === 2) {
      whole = digits.slice(0, lastSeparator);
      fraction = tail;
    }
  }
  const wholeDigits = whole.replace(/[.,]/g, "");
  if (wholeDigits === "") return null;
  const cents = Number(wholeDigits) * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** "26 nov 2026 - 09h02" (Ecuador local time) -> ISO UTC. Null when it does not parse to a real date. */
export function parseEcuadorDateTime(raw: string): string | null {
  const match = /(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})\s*[-–—,]?\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})/i.exec(fold(raw));
  if (!match) return null;
  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const month = MONTHS[(monthRaw ?? "").slice(0, 3)];
  if (month === undefined) return null;
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const year = Number(yearRaw);
  if (hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month, day, hour + ECUADOR_UTC_OFFSET_HOURS, minute));
  // Reject overflowing days such as "31 nov".
  const local = new Date(date.getTime() - ECUADOR_UTC_OFFSET_HOURS * 3_600_000);
  if (local.getUTCDate() !== day || local.getUTCMonth() !== month) return null;
  return date.toISOString();
}

/** "Coop. Jep ********0000" -> bank "Coop. Jep", account "********0000". */
function splitOrigin(value: string): { bank: string | null; account: string | null } {
  const match = /^(.*?)\s*([*•x]{2,}\s?\d{2,}|\d{4,})\s*$/i.exec(value);
  if (!match) return { bank: value || null, account: null };
  const bank = (match[1] ?? "").trim();
  return { bank: bank || null, account: (match[2] ?? "").replace(/\s+/g, "") };
}

const sameName = (a: string, b: string): boolean => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

export type DeunaParse = { ok: true; payment: DeunaPayment } | { ok: false; missing: string[] };

const fail = (...missing: string[]): DeunaParse => ({ ok: false, missing });

function parseText(text: string): DeunaParse {
  const flat = flatten(text);
  const folded = fold(flat);
  const heading = folded.search(/detalles de tu pago/);
  if (heading === -1) return fail("details_heading");

  // The intro sentence sits before the details and must agree with the table.
  const intro = /recibiste\s+(\$\s*\d[\d.,]*)\s+de\s+(.+?)\s+con deuna/i.exec(flat.slice(0, heading));
  if (!intro) return fail("intro");

  const fields = extractFields(flat);
  if ("missing" in fields) return fail(fields.missing);

  const missing: string[] = [];
  const amountCents = MONEY_SLOT.test(fold(fields.amount)) ? parseAmountCents(fields.amount) : null;
  if (amountCents === null) missing.push("amount");
  else if (parseAmountCents(intro[1] ?? "") !== amountCents) missing.push("amount_matches_intro");
  if (!fields.payer) missing.push("payer_name");
  else if (!sameName(fields.payer, intro[2] ?? "")) missing.push("payer_matches_intro");

  const receivedAt = parseEcuadorDateTime(fields.date);
  if (!receivedAt) missing.push("date");
  const transactionNumber = /^(\d{6,20})(?:\s|$)/.exec(fields.transaction)?.[1];
  if (!transactionNumber) missing.push("transaction_number");
  const destinationAccount = /^[*•x]*\d{3,}$/i.exec(fields.destination)?.[0];
  if (!destinationAccount) missing.push("destination_account");
  if (missing.length > 0 || amountCents === null || !receivedAt || !transactionNumber || !destinationAccount) return fail(...missing);

  const origin = splitOrigin(fields.origin);
  return {
    ok: true,
    payment: {
      transactionNumber,
      amountCents,
      receivedAt,
      originBank: origin.bank,
      originAccount: origin.account,
      destinationAccount,
      payerName: fields.payer,
      motive: fields.motive ? fields.motive : null,
    },
  };
}

/** Tries the plain text part first, then the HTML part stripped to text. On failure says which pieces were missing (never the content). */
export function parseDeunaDetailed(content: { text?: string | undefined; html?: string | undefined }): DeunaParse {
  let last: DeunaParse = fail("content");
  if (content.text) {
    last = parseText(content.text);
    if (last.ok) return last;
  }
  if (content.html) last = parseText(htmlToText(content.html));
  return last;
}

export function parseDeunaEmail(content: { text?: string | undefined; html?: string | undefined }): DeunaPayment | null {
  const result = parseDeunaDetailed(content);
  return result.ok ? result.payment : null;
}
