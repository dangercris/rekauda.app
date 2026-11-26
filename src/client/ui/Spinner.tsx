import { cx } from "../lib/cx";
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  /** Pixel size. Default 18. */
  size?: number | undefined;
  /** Accessible label; omit when a parent already announces the busy state. */
  label?: string | undefined;
  className?: string | undefined;
}

export function Spinner({ size = 18, label, className }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
