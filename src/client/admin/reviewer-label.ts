const TREASURY_LABEL = "tesorería";

/**
 * Human label for who reviewed a payment. `deuna` and `script` are automatic
 * reviewers; any other non-empty value is a person (the shared admin session
 * or a real user id) and counts as treasury.
 */
export function reviewerLabel(reviewedBy: string | null): string | null {
  if (!reviewedBy) return null;
  if (reviewedBy === "deuna") return "notificación de Deuna";
  if (reviewedBy === "script") return "revisión automática";
  return TREASURY_LABEL;
}

/** True when a person (not an automatic reviewer) reviewed the payment. Shares the rules of `reviewerLabel`. */
export function isTreasuryReviewer(reviewedBy: string | null): boolean {
  return reviewerLabel(reviewedBy) === TREASURY_LABEL;
}
