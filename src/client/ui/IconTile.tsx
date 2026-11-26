import { cx } from "../lib/cx";
import styles from "./IconTile.module.css";
import { renderSlot, type IconSlot } from "./slot";

export type Tone = "event" | "ok" | "warn" | "bad" | "info" | "neutral";

export interface IconTileProps {
  icon: IconSlot;
  /** 26 (activity), 28 (checks), 38 (alerts), 46 (section headers). Default 46. */
  size?: 26 | 28 | 38 | 40 | 46 | undefined;
  tone?: Tone | undefined;
  /** soft tint (default) or solid fill. */
  fill?: "soft" | "solid" | undefined;
  shape?: "rounded" | "circle" | undefined;
  className?: string | undefined;
}

const ICON: Record<NonNullable<IconTileProps["size"]>, number> = { 26: 14, 28: 15, 38: 18, 40: 19, 46: 22 };

/** Tinted square or circle holding an icon (section headers, activity rows, validations). Decorative. */
export function IconTile({ icon, size = 46, tone = "event", fill = "soft", shape = "rounded", className }: IconTileProps) {
  return (
    <span aria-hidden="true" className={cx(styles.tile, styles[`s${size}`], styles[`${fill}_${tone}`], shape === "circle" && styles.circle, className)}>
      {renderSlot(icon, ICON[size], size <= 28 ? 2.4 : 1.8)}
    </span>
  );
}
