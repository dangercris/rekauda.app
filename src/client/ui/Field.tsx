import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import styles from "./Field.module.css";
import { Icon } from "./Icon";

export interface FieldIds {
  inputId: string;
  hintId: string | undefined;
  errorId: string | undefined;
  describedBy: string | undefined;
}

/** Stable ids wiring label, hint and error to a control (`aria-describedby`). */
export function useFieldIds(id: string | undefined, hasHint: boolean, hasError: boolean, extraDescribedBy?: string): FieldIds {
  const auto = useId();
  const inputId = id ?? `f${auto}`;
  const hintId = hasHint ? `${inputId}-hint` : undefined;
  const errorId = hasError ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId, extraDescribedBy].filter(Boolean).join(" ") || undefined;
  return { inputId, hintId, errorId, describedBy };
}

export interface FieldShellProps {
  label: ReactNode;
  ids: FieldIds;
  hint?: ReactNode;
  error?: ReactNode;
  /** Appends "(opcional)" to the label. */
  optional?: boolean | undefined;
  /** Visually hide the label (it stays accessible). */
  hideLabel?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** Label above, control, then error (replaces nothing: hint stays) below. */
export function FieldShell({ label, ids, hint, error, optional, hideLabel, className, children }: FieldShellProps) {
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={ids.inputId} className={cx(styles.label, hideLabel && "visually-hidden")}>
        {label}
        {optional && <span className={styles.optional}> (opcional)</span>}
      </label>
      {children}
      {error ? (
        <p id={ids.errorId} className={styles.error}>
          <Icon name="alert-circle" size={15} strokeWidth={2} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={ids.hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export { styles as fieldStyles };
