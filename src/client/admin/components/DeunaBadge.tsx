import type { PaymentBankMovement } from "../../../shared/api";
import { dateTime, formatMoney } from "../../lib/format";
import { Icon } from "../../ui";
import styles from "./DeunaBadge.module.css";

/** Facts of the Deuna notification: transaction, payer, amount and time. */
export function movementFacts(movement: PaymentBankMovement): string {
  const parts = [
    `N.º ${movement.transactionNumber}`,
    movement.payerName,
    formatMoney(movement.amountCents),
    dateTime(movement.receivedAt),
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Compact "Confirmado por Deuna" line for list rows (icon, label and facts on one truncated line). */
export function DeunaBadge({ movement }: { movement: PaymentBankMovement }) {
  return (
    <span className={styles.badge}>
      <Icon name="check" size={12} strokeWidth={2.6} />
      <strong className={styles.label}>Confirmado por Deuna</strong>
      <span className={styles.facts}>{movementFacts(movement)}</span>
    </span>
  );
}
