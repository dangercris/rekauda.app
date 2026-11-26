/**
 * Pure matching of a bank movement (from the Deuna mail) to a registered payment.
 * Amount equality and the date window are mandatory; the rest is a score built from the payer name
 * (against the representative and the students' surnames) and the origin bank.
 * Auto-link only when exactly one candidate clears the threshold and nobody else is close.
 */

export interface MatchMovement {
  amountCents: number;
  /** ISO 8601 UTC. */
  receivedAt: string;
  payerName: string | null;
  originBank: string | null;
}

export interface MatchCandidate {
  id: string;
  parentName: string;
  amountCents: number;
  /** YYYY-MM-DD, Ecuador calendar day declared by the family. */
  transferDate: string;
  bank: string;
  /** Surnames of every student in the payment (as typed by the family). */
  studentSurnames: string[];
}

export interface MatchResult {
  paymentId: string;
  score: number;
}

export const AUTO_LINK_THRESHOLD = 0.6;
/** The best candidate must beat every other candidate by at least this much. */
export const RUNNER_UP_MARGIN = 0.15;
/** Days the movement may be after (+) or before (-) the date the family declared. */
export const DATE_WINDOW = { minDays: -1, maxDays: 2 } as const;

const W_AMOUNT = 0.2;
const W_DATE_SAME_DAY = 0.25;
const W_DATE_NEARBY = 0.15;
const W_NAME = 0.45;
const W_BANK = 0.1;
const SINGLE_TOKEN_NAME = 0.3;
const MIN_PREFIX = 3;
const MIN_AUTO_NAME_TOKENS = 2;

const STOPWORDS = new Set(["de", "del", "la", "las", "los", "y", "e", "van", "von"]);
const BANK_NOISE = new Set(["banco", "bco", "cooperativa", "coop", "cac", "ahorro", "credito", "de", "del", "la", "el", "y", "deuna"]);

export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Lowercase, no accents, alphanumeric tokens of at least 2 characters. */
export function tokens(value: string): string[] {
  return foldText(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function nameTokens(value: string): string[] {
  return [...new Set(tokens(value).filter((t) => !STOPWORDS.has(t)))];
}

/** Equal tokens, or one is a prefix of the other ("iri" vs "iris") with at least 3 characters in common. */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_PREFIX && long.startsWith(short);
}

interface NameMatch {
  matched: number;
  similarity: number;
}

function compareNames(payer: string[], reference: string[]): NameMatch {
  if (payer.length === 0 || reference.length === 0) return { matched: 0, similarity: 0 };
  const used = new Set<number>();
  let matched = 0;
  for (const token of payer) {
    const at = reference.findIndex((r, i) => !used.has(i) && tokenMatches(token, r));
    if (at !== -1) {
      used.add(at);
      matched += 1;
    }
  }
  if (matched === 0) return { matched, similarity: 0 };
  // One shared token (a common given name) is weak evidence: it ranks, but never auto-links.
  if (matched === 1) return { matched, similarity: SINGLE_TOKEN_NAME };
  return { matched, similarity: matched / Math.min(payer.length, reference.length) };
}

/** Similarity 0..1 between the payer and a reference name. One shared token is weak evidence, two or more is strong. */
export function nameSimilarity(payer: string[], reference: string[]): number {
  return compareNames(payer, reference).similarity;
}

/** Ecuador calendar day (YYYY-MM-DD) of an ISO instant. */
export function ecuadorDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

function bankBonus(originBank: string | null, paymentBank: string): number {
  if (!originBank) return 0;
  const distinctive = tokens(originBank).filter((t) => !BANK_NOISE.has(t));
  if (distinctive.length === 0) return 0;
  const target = tokens(paymentBank);
  return distinctive.every((t) => target.some((p) => tokenMatches(t, p))) ? W_BANK : 0;
}

export interface ScoreDetail {
  score: number;
  /** Score without the bank bonus: the bonus alone must never decide an auto-link. */
  base: number;
  /** Name tokens shared with the best reference (representative or students' surnames). */
  nameTokens: number;
}

export function scoreDetail(movement: MatchMovement, candidate: MatchCandidate): ScoreDetail | null {
  if (candidate.amountCents !== movement.amountCents) return null;
  const delta = dayNumber(ecuadorDay(movement.receivedAt)) - dayNumber(candidate.transferDate);
  if (!Number.isFinite(delta) || delta < DATE_WINDOW.minDays || delta > DATE_WINDOW.maxDays) return null;

  const payer = movement.payerName ? nameTokens(movement.payerName) : [];
  const parent = compareNames(payer, nameTokens(candidate.parentName));
  const students = compareNames(payer, nameTokens(candidate.studentSurnames.join(" ")));
  const best = parent.similarity >= students.similarity ? parent : students;

  const base = W_AMOUNT + (delta === 0 ? W_DATE_SAME_DAY : W_DATE_NEARBY) + W_NAME * best.similarity;
  return {
    score: Math.round((base + bankBonus(movement.originBank, candidate.bank)) * 1000) / 1000,
    base: Math.round(base * 1000) / 1000,
    nameTokens: Math.max(parent.matched, students.matched),
  };
}

/** Score 0..1 of one candidate, or null when amount or date rule it out. Used to rank, not to auto-link. */
export function scoreCandidate(movement: MatchMovement, candidate: MatchCandidate): number | null {
  return scoreDetail(movement, candidate)?.score ?? null;
}

/** Auto-link needs at least two matching name tokens and a score that clears the threshold without the bank bonus. */
function autoLinkable(detail: ScoreDetail): boolean {
  return detail.nameTokens >= MIN_AUTO_NAME_TOKENS && detail.base >= AUTO_LINK_THRESHOLD;
}

/** The single clear match, or null (the movement stays unmatched for the treasurer). */
export function pickMatch(movement: MatchMovement, candidates: readonly MatchCandidate[]): MatchResult | null {
  const scored = candidates
    .flatMap((c) => {
      const detail = scoreDetail(movement, c);
      return detail ? [{ paymentId: c.id, detail }] : [];
    })
    .sort((a, b) => b.detail.score - a.detail.score);

  const best = scored[0];
  if (!best || !autoLinkable(best.detail)) return null;
  // Anyone else who would also qualify makes it ambiguous; anyone close in score does too.
  const rivals = scored.slice(1);
  if (rivals.some((r) => autoLinkable(r.detail) || best.detail.score - r.detail.score < RUNNER_UP_MARGIN)) return null;
  return { paymentId: best.paymentId, score: best.detail.score };
}
