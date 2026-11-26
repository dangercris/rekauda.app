import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { IconTile, type Tone } from "./IconTile";
import styles from "./Notice.module.css";
import type { IconSlot } from "./slot";

export interface NoticeProps {
  tone?: Tone | undefined;
  icon: IconSlot;
  title: ReactNode;
  description?: ReactNode;
  /** Trailing control (e.g. "Recordar" ink button, "Deshacer" soft button). */
  action?: ReactNode;
  /** tile = rounded tinted icon (alerts), solid = big filled circle (results like "Pago verificado"). */
  iconStyle?: "tile" | "solid" | undefined;
  /** Announce politely when it appears (results of an action). */
  live?: boolean | undefined;
  className?: string | undefined;
}

/** Glass notice row: tinted icon, title and description, optional action. */
export function Notice({ tone = "event", icon, title, description, action, iconStyle = "tile", live, className }: NoticeProps) {
  return (
    <div className={cx("m-glass", styles.notice, styles[iconStyle], className)} role={live ? "status" : undefined}>
      {iconStyle === "solid" ? (
        <IconTile icon={icon} size={46} tone={tone} fill="solid" shape="circle" className={styles.solidIcon} />
      ) : (
        <IconTile icon={icon} size={38} tone={tone} />
      )}
      <span className={styles.text}>
        <strong className={styles.title}>{title}</strong>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      {action && <span className={styles.action}>{action}</span>}
    </div>
  );
}
