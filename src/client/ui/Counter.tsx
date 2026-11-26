import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./Counter.module.css";
import { IconButton } from "./IconButton";

export interface CounterProps {
  value: number;
  onChange: (value: number) => void;
  min?: number | undefined;
  max?: number | undefined;
  /** Visible label on the left (e.g. "Estudiantes"). Also names the group. */
  label: ReactNode;
  description?: ReactNode;
  /** Value rendering, e.g. `(n) => plural(n, "estudiante", "estudiantes")`. */
  format?: ((value: number) => ReactNode) | undefined;
  decrementLabel?: string | undefined;
  incrementLabel?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/** Stepper input (- value +) clamped to [min, max]; buttons disable at the bounds. Value changes are announced. */
export function Counter({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  label,
  description,
  format,
  decrementLabel = "Quitar uno",
  incrementLabel = "Agregar uno",
  disabled,
  className,
}: CounterProps) {
  const id = useId();
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  const set = (n: number) => {
    const next = clamp(n);
    if (next !== value) onChange(next);
  };
  return (
    <div role="group" aria-labelledby={`${id}-label`} className={cx(styles.counter, className)}>
      <span className={styles.text}>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      <span className={cx("m-glass-strong", styles.control)}>
        <IconButton
          icon="minus"
          label={decrementLabel}
          variant="ghost"
          size={40}
          disabled={disabled || value <= min}
          onClick={() => set(value - 1)}
        />
        <output className={cx(styles.value, "num")} aria-live="polite" aria-atomic="true">
          {format ? format(value) : value}
        </output>
        <IconButton
          icon="plus"
          label={incrementLabel}
          variant="ghost"
          size={40}
          disabled={disabled || value >= max}
          onClick={() => set(value + 1)}
        />
      </span>
    </div>
  );
}
