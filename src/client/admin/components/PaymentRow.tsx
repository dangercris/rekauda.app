import type { AdminPayment } from "../../../shared/api";
import { formatMoney, relative, timeOfDay } from "../../lib/format";
import { Avatar, Icon, ListRow, Money, StatusPill } from "../../ui";
import { optionLabels, paymentFlags, studentName, studentNames } from "../data/payments";
import { DeunaBadge } from "./DeunaBadge";
import styles from "./PaymentRow.module.css";

export interface PaymentRowProps {
  payment: AdminPayment;
  /** "time" when rows are grouped by day (shows 10:42), "relative" otherwise (Hoy · 10:42). */
  when?: "time" | "relative" | undefined;
  /** Hide the status pill (lists that are already one status). */
  hideStatus?: boolean | undefined;
}

/** Payment row: students, options and representative, amount (flagged when it differs), status, alerts. */
export function PaymentRow({ payment, when = "time", hideStatus }: PaymentRowProps) {
  const flags = paymentFlags(payment);
  const first = payment.students[0];
  const avatarName = first ? studentName(first) : payment.parentName;
  const date = when === "time" ? timeOfDay(payment.createdAt) : relative(payment.createdAt);
  const distinct = new Set(payment.students.map((st) => st.option)).size;
  const labels = distinct > 1 ? `${payment.students.length} estudiantes` : optionLabels(payment);
  const observation = payment.status === "observado" || payment.status === "anulado" ? payment.reviewNote : null;
  const mismatch = payment.flags.amountMismatch;
  const deuna = payment.bankMovement;

  return (
    <ListRow
      href={`#pago/${payment.id}`}
      leading={<Avatar name={avatarName} />}
      title={studentNames(payment)}
      subtitle={
        <>
          {labels && <span className={styles.option}>{labels}</span>}
          {labels && " · "}
          {payment.parentName}
          {date && ` · ${date}`}
        </>
      }
      note={
        flags.length > 0 || observation || deuna ? (
          <span className={styles.notes}>
            {deuna && <DeunaBadge movement={deuna} />}
            {flags.length > 0 && (
              <span className={styles.flags}>
                <Icon name="alert" size={12} strokeWidth={2.4} />
                {flags.map((f) => f.label).join(" · ")}
              </span>
            )}
            {observation && <span className={styles.observation}>{observation}</span>}
          </span>
        ) : undefined
      }
      trailing={
        <span className={mismatch ? styles.mismatch : undefined}>
          <Money cents={payment.amountCents} />
          {mismatch && <span className="visually-hidden">{`, se esperaba ${formatMoney(payment.expectedCents)}`}</span>}
        </span>
      }
      trailingMeta={hideStatus ? undefined : <StatusPill status={payment.status} size="sm" />}
      chevron={false}
    />
  );
}
