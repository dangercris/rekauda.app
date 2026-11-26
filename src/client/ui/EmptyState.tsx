import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./EmptyState.module.css";
import { renderSlot, type IconSlot } from "./slot";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconSlot | undefined;
  /** Usually a Button. */
  action?: ReactNode;
  /** Render inside a glass card (default) or bare. */
  bare?: boolean | undefined;
  className?: string | undefined;
}

/** "Nothing here" block: filters with no results, no collections yet, lookup not found. */
export function EmptyState({ title, description, icon, action, bare, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, !bare && "m-glass", !bare && styles.card, className)}>
      {icon !== undefined && <span className={styles.icon}>{renderSlot(icon, 22)}</span>}
      <strong className={styles.title}>{title}</strong>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
