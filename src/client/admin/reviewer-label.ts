/**
 * Human label for who reviewed a payment. `deuna` and `script` are automatic
 * reviewers; any other non-empty value is a person (the shared admin session
 * or a real user id) and counts as treasury.
 */
export function reviewerLabel(reviewedBy: string | null): string | null {
  if (!reviewedBy) return null;
  if (reviewedBy === "deuna") return "notificación de Deuna";
  if (reviewedBy === "script") return "revisión automática";
  return "tesorería";
}
