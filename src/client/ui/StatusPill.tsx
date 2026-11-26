import type { PaymentStatus } from "../../shared/api";
import { cx } from "../lib/cx";
import { Icon } from "./Icon";
import { STATUS_META } from "./status";
import styles from "./StatusPill.module.css";

export interface StatusPillProps {
  status: PaymentStatus;
  /** sm 22px (lists), md 28px (default), lg 30px (detail headers). */
  size?: "sm" | "md" | "lg" | undefined;
  /** Hide the icon (keep it when the pill is the only status signal). */
  hideIcon?: boolean | undefined;
  className?: string | undefined;
}

/** Tinted status label with icon. Light and dark palettes come from the status tokens. */
export function StatusPill({ status, size = "md", hideIcon, className }: StatusPillProps) {
  const meta = STATUS_META[status];
  return (
    <span className={cx(styles.pill, styles[size], styles[meta.tone], className)}>
      {!hideIcon && <Icon name={meta.icon} size={size === "sm" ? 11 : 13} strokeWidth={2.4} />}
      {meta.label}
    </span>
  );
}
