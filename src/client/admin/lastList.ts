/**
 * Remembers which payments list (status filter) the representative came from, so the verify screen's
 * back button and "back to the list" return to the same filter.
 */
let lastPaymentsHash = "#pagos";

export function rememberPaymentsHash(hash: string): void {
  lastPaymentsHash = hash;
}

export function paymentsBackHash(): string {
  return lastPaymentsHash;
}
