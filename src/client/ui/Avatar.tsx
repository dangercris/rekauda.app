import { cx } from "../lib/cx";
import { initials } from "../lib/format";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  /** Person or group name; initials are derived from it. */
  name: string;
  /** Override the derived initials (e.g. "5B"). */
  text?: string | undefined;
  /** 34 (brand pill), 42 (rows, default), 56 (detail header). */
  size?: 34 | 42 | 56 | undefined;
  /** soft = event tint (default), solid = event fill, ink = neutral dark. */
  variant?: "soft" | "solid" | "ink" | undefined;
  /** Decorative by default (the name is usually next to it). */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

/** Initials in a circle, colored by the nearest event tone (wrap in ToneScope per row for mixed events). */
export function Avatar({ name, text, size = 42, variant = "soft", decorative = true, className }: AvatarProps) {
  return (
    <span
      className={cx(styles.avatar, styles[`s${size}`], styles[variant], variant === "ink" && "m-ink", className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
    >
      {text ?? initials(name)}
    </span>
  );
}
