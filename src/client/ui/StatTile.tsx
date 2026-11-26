import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { IconTile, type Tone } from "./IconTile";
import { Link } from "./Link";
import styles from "./StatTile.module.css";
import type { IconSlot } from "./slot";

export interface StatTileProps {
  label: ReactNode;
  /** Big figure: a number, "58%" or a <Money variant="stat" />. */
  value: ReactNode;
  icon?: IconSlot | undefined;
  tone?: Tone | undefined;
  /** Line under the value, e.g. "$126,00 en revisión". */
  meta?: ReactNode;
  /** Color the meta line with the tone (warn/ok/...). */
  metaToned?: boolean | undefined;
  /** Makes the whole tile a link. */
  href?: string | undefined;
  className?: string | undefined;
}

/** Admin metric tile (AdminResumen): label with icon, big tabular value, meta line. */
export function StatTile({ label, value, icon, tone = "neutral", meta, metaToned, href, className }: StatTileProps) {
  const body = (
    <>
      <span className={styles.head}>
        <span>{label}</span>
        {icon !== undefined && <IconTile icon={icon} size={26} tone={tone} shape="circle" />}
      </span>
      <span className={cx(styles.value, "num")}>{value}</span>
      {meta && <span className={cx(styles.meta, "num", metaToned && styles[`meta_${tone}`])}>{meta}</span>}
    </>
  );
  const classes = cx("m-glass", styles.tile, href && styles.link, className);
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
