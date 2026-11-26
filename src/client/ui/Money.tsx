import { cx } from "../lib/cx";
import { moneyParts } from "../lib/format";
import styles from "./Money.module.css";

export type MoneyVariant = "display" | "stat" | "title" | "inline";

export interface MoneyProps {
  cents: number;
  /** display 46px with cents at ~50% in muted color, stat 36px, title 21px bold, inline inherits. Default inline. */
  variant?: MoneyVariant | undefined;
  /** Drop ",00" on whole amounts ("$315 de $480"). */
  compact?: boolean | undefined;
  className?: string | undefined;
}

/** Money in es-EC format with tabular figures: "$1.696,00". Cents are de-emphasized on display sizes. */
export function Money({ cents, variant = "inline", compact, className }: MoneyProps) {
  const p = moneyParts(cents);
  const showCents = !(compact && p.cents === "00");
  return (
    <span className={cx(styles.money, styles[variant], className)}>
      {p.negative && "-"}
      {p.symbol}
      {p.int}
      {showCents && <span className={styles.cents}>,{p.cents}</span>}
    </span>
  );
}
